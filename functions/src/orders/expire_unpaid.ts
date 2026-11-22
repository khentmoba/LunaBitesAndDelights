import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { toIsoTimestamp } from './kds';

export const STALE_UNPAID_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;
const MAX_PAGES = 10;

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
    const db = getFirestore();
    const nowMs = Date.now();
    let expired = 0;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let q = db
        .collection('orders')
        .where('paymentStatus', '==', 'AWAITING_PAYMENT')
        .limit(BATCH_LIMIT);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;

      for (const doc of snap.docs) {
        if (!isStaleUnpaidOrder(doc.data(), nowMs)) continue;
        const updated = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          const freshData = fresh.exists ? fresh.data() : undefined;
          if (!freshData || !isStaleUnpaidOrder(freshData, nowMs)) return false;
          tx.update(doc.ref, expireUnpaidUpdate(freshData));
          return true;
        });
        if (updated) expired++;
      }

      if (snap.docs.length < BATCH_LIMIT) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    if (expired > 0) {
      logger.info(`Expired ${expired} stale AWAITING_PAYMENT order(s)`);
    }
  },
);
