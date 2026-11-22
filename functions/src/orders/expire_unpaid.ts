import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { toIsoTimestamp } from './kds';

export const STALE_UNPAID_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

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

/**
 * Daily sweep that expires abandoned GCash `AWAITING_PAYMENT` orders older than
 * 24 hours so they stop consuming active-order scan pages. Uses a single-field
 * equality query (`paymentStatus == 'AWAITING_PAYMENT'`) to avoid requiring a
 * new composite Firestore index.
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
    const snap = await db
      .collection('orders')
      .where('paymentStatus', '==', 'AWAITING_PAYMENT')
      .limit(BATCH_LIMIT)
      .get();

    if (snap.empty) return;

    let expired = 0;
    for (const doc of snap.docs) {
      if (!isStaleUnpaidOrder(doc.data(), nowMs)) continue;
      const updated = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists || !isStaleUnpaidOrder(fresh.data(), nowMs)) return false;
        tx.update(doc.ref, {
          paymentStatus: 'PAYMENT_EXPIRED',
          status: 'Cancelled',
          cancellationReason: 'Payment session expired',
        });
        return true;
      });
      if (updated) expired++;
    }

    if (expired > 0) {
      logger.info(`Expired ${expired} stale AWAITING_PAYMENT order(s)`);
    }
  },
);
