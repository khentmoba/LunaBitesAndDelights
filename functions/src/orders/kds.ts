import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { requireStaff, validDocId, cleanStr, optStr } from '../util/security';

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

const itemQty = (i: any): number => Number(i?.quantity) || Number(i?.qty) || 0;
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
    lat: typeof d.lat === 'number' ? d.lat : null,
    lng: typeof d.lng === 'number' ? d.lng : null,
    deliveryFee: Number(d.deliveryFee) || 0,
    paymentMethod: String(d.paymentMethod || 'Cash'),
    paymentStatus: String(d.paymentStatus || 'NOT PAID'),
    entryType: String(d.entryType || ''),
    items: rawItems.map((i: any) => {
      const qty = itemQty(i);
      return {
        name: String(i.name || ''),
        variant: String(i.variant || ''),
        qty,
        quantity: qty,
        price: Number(i.price) || 0,
      };
    }),
    itemsCount: rawItems.reduce((s: number, i: any) => s + itemQty(i), 0),
    total: Number(d.totalAmount) || 0,
    type: String(d.type || ''),
    status: String(d.status || 'Pending'),
    timestamp: toIsoTimestamp(d.timestamp),
  };
};

/** Lightweight summary projection for dashboard tiles without items[] or customer PII. */
export const projectOrderSummary = (
  id: string,
  d: FirebaseFirestore.DocumentData,
  legacyItemsCount?: number,
) => {
  const storedItemsCount = Number(d.itemsCount);
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
    itemsCount: Number.isFinite(storedItemsCount) && storedItemsCount >= 0
      ? storedItemsCount
      : fallbackItemsCount,
    total: Number(d.totalAmount) || 0,
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
  const legacyDocs = docs.filter((doc) => {
    const count = Number(doc.get('itemsCount'));
    return !Number.isFinite(count) || count < 0;
  });
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

export const getActiveOrders = onCall(async (request) => {
  requireStaff(request); // #6 + #7
  const db = getFirestore();
  const includeCompleted = request.data?.includeCompleted === true;
  const summaryOnly = request.data?.summaryOnly === true;
  const maxDocs = clampOrdersLimit(request.data?.limit);
  try {
    // 7-day lookback so yesterday's active and history orders are never cut off
    const lookbackThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const pageSize = Math.min(Math.max(maxDocs * 2, 50), MAX_ORDERS_LIMIT);
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
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Order not found');
      }
      const currentStatus = String(snap.data()?.status || 'Pending');
      if (!isAllowedStatusTransition(currentStatus, status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot transition order from ${currentStatus} to ${status}`,
        );
      }
      if (currentStatus === status && !cancellationReason) return;
      const update: Record<string, any> = { status };
      if (cancellationReason) update.cancellationReason = cancellationReason;
      tx.update(orderRef, update);
    });
    logger.info(`Order ${orderId} status updated to ${status}`);
    return { success: true };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    if (error?.code === 5 || error?.code === 'not-found') {
      throw new HttpsError('not-found', 'Order not found');
    }
    logger.error(`Error updating order ${orderId} status:`, error);
    throw new HttpsError('internal', 'Failed to update order status');
  }
});
