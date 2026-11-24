import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { requireStaff, validDocId, cleanStr, optStr } from '../util/security';
import { finiteNumber } from '../util';

const VALID_STATUSES = ['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
const ALLOWED_STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  Pending: new Set(['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled']),
  Preparing: new Set(['Preparing', 'Ready', 'Completed', 'Cancelled']),
  Ready: new Set(['Ready', 'Completed', 'Cancelled']),
  Completed: new Set(['Completed']),
  Cancelled: new Set(['Cancelled']),
};
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const MAX_ORDERS_LIMIT = 200;
/**
 * Hard ceiling on documents one `getActiveOrders` call may scan. The query
 * filters closed and unpaid orders in memory (the composite index that would
 * let Firestore do it is production-gated), so this ceiling has to sit well
 * above a busy week's order count or older still-active orders silently drop
 * off the kitchen board.
 */
export const MAX_SCAN_DOCS = 2000;

/** Validates whether an order can transition from `currentStatus` to `nextStatus`. */
export function isAllowedStatusTransition(currentStatus: string, nextStatus: string): boolean {
  const allowed = Object.prototype.hasOwnProperty.call(ALLOWED_STATUS_TRANSITIONS, currentStatus)
    ? ALLOWED_STATUS_TRANSITIONS[currentStatus]
    : undefined;
  return Boolean(allowed && allowed.has(nextStatus));
}

/**
 * Builds the Firestore update patch for `updateOrderStatus`, returning `null`
 * when no write is needed. Never overwrites an already-recorded cancellation
 * reason on a duplicate `Cancelled -> Cancelled` call.
 */
export function buildStatusUpdate(
  currentData: Record<string, any> | undefined,
  nextStatus: string,
  cancellationReason: string,
): Record<string, any> | null {
  const currentStatus = String(currentData?.status || 'Pending');
  const existingReason = typeof currentData?.cancellationReason === 'string'
    ? currentData.cancellationReason.trim()
    : '';
  if (currentStatus === nextStatus) {
    if (nextStatus === 'Cancelled' && cancellationReason && !existingReason) {
      return { status: nextStatus, cancellationReason };
    }
    return null;
  }
  const update: Record<string, any> = { status: nextStatus };
  if (cancellationReason) update.cancellationReason = cancellationReason;
  return update;
}

/** Computes a page size for `getActiveOrders` that minimizes over-fetching and never overshoots the scan ceiling. */
export function pageSizeForActiveOrders(
  maxDocs: number,
  includeCompleted: boolean,
  remainingScanBudget = MAX_SCAN_DOCS,
): number {
  const budget = Math.max(1, Math.trunc(remainingScanBudget));
  const base = includeCompleted
    ? Math.min(Math.max(maxDocs + 10, 20), MAX_ORDERS_LIMIT)
    : Math.min(Math.max(maxDocs * 2, 50), MAX_ORDERS_LIMIT);
  return Math.min(base, budget);
}

/** Clamps an optional caller-supplied limit to [1, 200], defaulting to 200. */
export function clampOrdersLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) return MAX_ORDERS_LIMIT;
  return Math.min(n, MAX_ORDERS_LIMIT);
}

/** Converts Firestore timestamps or ISO strings deterministically without crashing on invalid dates. */
export function toIsoTimestamp(raw: unknown): string {
  const fromObj = (raw as { toDate?: () => Date } | null | undefined)?.toDate?.();
  if (fromObj instanceof Date && !Number.isNaN(fromObj.getTime())) {
    return fromObj.toISOString();
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return EPOCH_ISO;
}

/** Excludes unpaid/failed online GCash checkouts from the kitchen display until payment clears. */
export function isOrderVisibleInKds(d: FirebaseFirestore.DocumentData): boolean {
  const method = String(d.paymentMethod || '').toLowerCase();
  const status = String(d.paymentStatus || '');
  return method !== 'gcash' || status === 'PAID';
}

const nonNegFinite = (v: unknown): number => {
  const n = finiteNumber(v);
  return n > 0 ? n : 0;
};
const itemQty = (i: any): number => nonNegFinite(i?.quantity) || nonNegFinite(i?.qty);
const countItems = (items: unknown): number => Array.isArray(items)
  ? items.reduce((sum: number, item: any) => sum + itemQty(item), 0)
  : 0;

// #17: trimmed projection — only what the KDS screen renders. Never ...data.
export const projectOrder = (id: string, d: FirebaseFirestore.DocumentData) => {
  const rawItems = Array.isArray(d.items) ? d.items : [];
  return {
    id,
    orderNumber: d.orderId || d.orderNumber || id,
    customerName: d.customerName || '',
    customerPhone: d.customerPhone || '',
    customerAddress: d.customerAddress || '',
    lat: typeof d.lat === 'number' && Number.isFinite(d.lat) && Math.abs(d.lat) <= 90 ? d.lat : null,
    lng: typeof d.lng === 'number' && Number.isFinite(d.lng) && Math.abs(d.lng) <= 180 ? d.lng : null,
    deliveryFee: nonNegFinite(d.deliveryFee),
    paymentMethod: String(d.paymentMethod || 'Cash'),
    paymentStatus: String(d.paymentStatus || 'NOT PAID'),
    entryType: String(d.entryType || ''),
    items: rawItems.map((i: any) => {
      const qty = itemQty(i);
      return {
        name: String(i?.name || ''),
        variant: String(i?.variant || ''),
        qty,
        quantity: qty,
        price: nonNegFinite(i?.price),
      };
    }),
    itemsCount: rawItems.reduce((s: number, i: any) => s + itemQty(i), 0),
    total: nonNegFinite(d.totalAmount),
    type: String(d.type || ''),
    status: String(d.status || 'Pending'),
    timestamp: toIsoTimestamp(d.timestamp),
  };
};

/** Returns a persisted non-negative numeric item count, or null when absent/invalid. */
export function validStoredItemsCount(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/** Lightweight summary projection for dashboard tiles without items[] or customer PII. */
export const projectOrderSummary = (
  id: string,
  d: FirebaseFirestore.DocumentData,
  legacyItemsCount?: number,
) => {
  const storedItemsCount = validStoredItemsCount(d.itemsCount);
  const fallbackItemsCount = typeof legacyItemsCount === 'number'
    && Number.isFinite(legacyItemsCount)
    && legacyItemsCount >= 0
    ? legacyItemsCount
    : countItems(d.items);
  return {
    id,
    orderNumber: d.orderId || d.orderNumber || id,
    customerName: d.customerName || '',
    paymentMethod: String(d.paymentMethod || 'Cash'),
    paymentStatus: String(d.paymentStatus || 'NOT PAID'),
    entryType: String(d.entryType || ''),
    itemsCount: storedItemsCount !== null ? storedItemsCount : fallbackItemsCount,
    total: nonNegFinite(d.totalAmount),
    type: String(d.type || ''),
    status: String(d.status || 'Pending'),
    timestamp: toIsoTimestamp(d.timestamp),
  };
};

const SUMMARY_ORDER_FIELDS = [
  'orderId',
  'orderNumber',
  'customerName',
  'paymentMethod',
  'paymentStatus',
  'entryType',
  'itemsCount',
  'totalAmount',
  'type',
  'status',
  'timestamp',
] as const;

const LEGACY_ITEM_COUNT_BATCH_SIZE = 100;

export async function getLegacyItemCounts(
  db: FirebaseFirestore.Firestore,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<Map<string, number>> {
  const legacyDocs = docs.filter((doc) => validStoredItemsCount(doc.get('itemsCount')) === null);
  const counts = new Map<string, number>();
  for (let i = 0; i < legacyDocs.length; i += LEGACY_ITEM_COUNT_BATCH_SIZE) {
    const batch = legacyDocs.slice(i, i + LEGACY_ITEM_COUNT_BATCH_SIZE);
    const snapshots = await db.getAll(...batch.map((doc) => doc.ref), { fieldMask: ['items'] });
    for (const snapshot of snapshots) {
      if (snapshot.exists) counts.set(snapshot.id, countItems(snapshot.get('items')));
    }
  }
  return counts;
}

/** True when applying the call would actually change the stored order. */
export interface StatusChangeOutcome {
  changed: boolean;
  previousStatus: string;
}

/**
 * Applies one status transition inside a transaction and answers for the
 * document it just read, so caller responses and logs can be derived from the
 * committed outcome rather than from the request.
 */
export async function applyOrderStatus(
  db: Pick<FirebaseFirestore.Firestore, 'runTransaction'>,
  orderRef: FirebaseFirestore.DocumentReference,
  status: string,
  cancellationReason: string,
): Promise<StatusChangeOutcome> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }
    const currentData = snap.data();
    const currentStatus = String(currentData?.status || 'Pending');
    if (!isAllowedStatusTransition(currentStatus, status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot transition order from ${currentStatus} to ${status}`,
      );
    }
    const update = buildStatusUpdate(currentData, status, cancellationReason);
    if (!update) return { changed: false, previousStatus: currentStatus };
    tx.update(orderRef, update);
    return { changed: true, previousStatus: currentStatus };
  });
}

export const getActiveOrders = onCall(async (request) => {
  requireStaff(request); // #6 + #7
  const db = getFirestore();
  const includeCompleted = request.data?.includeCompleted === true;
  const summaryOnly = request.data?.summaryOnly === true;
  const maxDocs = clampOrdersLimit(request.data?.limit);
  try {
    // 7-day lookback so yesterday's active and history orders are never cut off
    const lookbackThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const orders = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let scanned = 0;
    let truncated = false;

    while (orders.length < maxDocs) {
      // Every iteration either stops or advances the cursor by a whole page, so
      // this budget is the only termination guard the scan needs.
      if (scanned >= MAX_SCAN_DOCS) {
        truncated = true;
        break;
      }
      const pageSize = pageSizeForActiveOrders(maxDocs, includeCompleted, MAX_SCAN_DOCS - scanned);
      let q = db.collection('orders')
        .where('timestamp', '>=', lookbackThreshold)
        .orderBy('timestamp', 'desc')
        .limit(pageSize);
      if (summaryOnly) q = q.select(...SUMMARY_ORDER_FIELDS);
      if (cursor) q = q.startAfter(cursor);
      const snapshot = await q.get();
      if (snapshot.empty) break;
      scanned += snapshot.docs.length;

      const eligibleDocs = snapshot.docs
        .filter((doc) => {
          const data = doc.data();
          if (!isOrderVisibleInKds(data)) return false;
          const status = data.status || 'Pending';
          return includeCompleted || (status !== 'Completed' && status !== 'Cancelled');
        })
        .slice(0, maxDocs - orders.length);
      const legacyItemCounts = summaryOnly
        ? await getLegacyItemCounts(db, eligibleDocs)
        : new Map<string, number>();
      for (const doc of eligibleDocs) {
        const data = doc.data();
        orders.push(summaryOnly
          ? projectOrderSummary(doc.id, data, legacyItemCounts.get(doc.id))
          : projectOrder(doc.id, data));
      }

      if (snapshot.docs.length < pageSize) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    if (truncated) {
      logger.warn(
        `getActiveOrders stopped after scanning ${scanned} orders without filling ${maxDocs} slots; some active orders are not on the board`,
        { scanned, returned: orders.length, summaryOnly, includeCompleted },
      );
    }
    return { success: true, orders, scanned, truncated };
  } catch (error: any) {
    logger.error('Error fetching active orders:', error);
    throw new HttpsError('internal', 'Failed to fetch active orders');
  }
});

export const updateOrderStatus = onCall(async (request) => {
  requireStaff(request); // #6 + #7
  const orderId = validDocId(request.data?.orderId, 'orderId'); // #13
  const status = cleanStr(request.data?.status, 32, 'status'); // #14
  if (!VALID_STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Invalid status'); // #8
  const cancellationReason = status === 'Cancelled' ? optStr(request.data?.cancellationReason, 200) : '';

  const db = getFirestore();
  try {
    const orderRef = db.collection('orders').doc(orderId);
    const outcome = await applyOrderStatus(db, orderRef, status, cancellationReason);
    if (outcome.changed) {
      logger.info(`Order ${orderId} status updated from ${outcome.previousStatus} to ${status}`);
    } else {
      logger.info(`Order ${orderId} already ${status}; no write needed`);
    }
    return { success: true, changed: outcome.changed };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    if (error?.code === 5 || error?.code === 'not-found') {
      throw new HttpsError('not-found', 'Order not found');
    }
    logger.error(`Error updating order ${orderId} status:`, error);
    throw new HttpsError('internal', 'Failed to update order status');
  }
});
