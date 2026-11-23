import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { toIsoTimestamp } from './kds';

export const STALE_UNPAID_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;
const MAX_PAGES = 10;
const EXPIRE_CONCURRENCY = 10;

/**
 * Returns true when an order is still awaiting GCash payment and its timestamp
 * is at least `STALE_UNPAID_AGE_MS` (24h) old.
 */
export function isStaleUnpaidOrder(
  data: Record<string, any> | undefined,
  nowMs = Date.now(),
): boolean {
  if (!data || data.paymentStatus !== 'AWAITING_PAYMENT') return false;
  const iso = toIsoTimestamp(data.timestamp);
  const tsMs = Date.parse(iso);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return false;
  return nowMs - tsMs >= STALE_UNPAID_AGE_MS;
}

/** Builds the expiration patch without clobbering existing terminal statuses or cancellation reasons. */
export function expireUnpaidUpdate(data: Record<string, any>): Record<string, any> {
  const update: Record<string, any> = { paymentStatus: 'PAYMENT_EXPIRED' };
  if (data.status !== 'Cancelled' && data.status !== 'Completed') {
    update.status = 'Cancelled';
    update.cancellationReason = 'Payment session expired';
  }
  return update;
}

async function sweepExpiredOrders(
  db: Firestore,
  nowMs: number,
  batchLimit: number,
  maxPages: number,
  concurrency: number,
): Promise<{ expired: number; failed: number }> {
  let expired = 0;
  let failed = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (let page = 0; page < maxPages; page++) {
    let q = db
      .collection('orders')
      .where('paymentStatus', '==', 'AWAITING_PAYMENT')
      .limit(batchLimit);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const staleDocs = snap.docs.filter((doc) => isStaleUnpaidOrder(doc.data(), nowMs));
    for (let i = 0; i < staleDocs.length; i += concurrency) {
      const chunk = staleDocs.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map((doc) =>
          db.runTransaction(async (tx) => {
            const fresh = await tx.get(doc.ref);
            const freshData = fresh.exists ? fresh.data() : undefined;
            if (!freshData || !isStaleUnpaidOrder(freshData, nowMs)) return false;
            tx.update(doc.ref, expireUnpaidUpdate(freshData));
            return true;
          }),
        ),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          if (result.value) expired++;
        } else {
          failed++;
          logger.warn(`Failed to expire stale unpaid order ${chunk[j].id}; continuing sweep`, result.reason);
        }
      }
    }

    if (snap.docs.length < batchLimit) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return { expired, failed };
}

/**
 * Scans up to `MAX_PAGES * BATCH_LIMIT` `AWAITING_PAYMENT` orders and expires
 * those older than `STALE_UNPAID_AGE_MS`, isolating per-order transaction errors
 * so a single contended document cannot abort the rest of the sweep.
 */
export async function expireStaleUnpaidBatch(
  db: Firestore = getFirestore(),
  nowMs = Date.now(),
): Promise<{ expired: number; failed: number }> {
  return sweepExpiredOrders(db, nowMs, BATCH_LIMIT, MAX_PAGES, EXPIRE_CONCURRENCY);
}

/** Configurable form used by focused sweep tests. */
export async function sweepStaleUnpaidOrders(
  db: Firestore = getFirestore(),
  opts: { nowMs?: number; batchLimit?: number; maxPages?: number; concurrency?: number } = {},
): Promise<{ expired: number; failed: number }> {
  return sweepExpiredOrders(
    db,
    opts.nowMs ?? Date.now(),
    opts.batchLimit ?? BATCH_LIMIT,
    opts.maxPages ?? MAX_PAGES,
    Math.max(1, opts.concurrency ?? EXPIRE_CONCURRENCY),
  );
}

/**
 * Daily sweep that expires abandoned GCash `AWAITING_PAYMENT` orders older than
 * 24 hours so they stop consuming active-order scan pages. Uses a single-field
 * equality query (`paymentStatus == 'AWAITING_PAYMENT'`) with cursor pagination
 * to avoid requiring a composite Firestore index or starving behind newer docs.
 */
export const expireStaleUnpaidOrders = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Asia/Manila',
    memory: '256MiB',
  },
  async () => {
    const { expired, failed } = await expireStaleUnpaidBatch();
    if (expired > 0 || failed > 0) {
      logger.info(`Expired ${expired} stale AWAITING_PAYMENT order(s) (${failed} failed)`);
    }
  },
);
