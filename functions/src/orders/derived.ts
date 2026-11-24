import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  isOrderVisibleInKds,
  kdsMirrorDoc,
} from './kds';
import { notifyOrderOnce, notifyPaymentConfirmedOnce } from './send_notification';
import { isPermanentTelegramError, hasTelegramConfig } from '../telegram_api';
import { dayDeltas, incrementPayload } from '../reporting/daily_stats';
import { telegramToken, telegramChatIds, googleMapsApiKey } from '../secrets';

export { kdsMirrorDoc };
export const KDS_COLLECTION = 'kds_orders';
export const DAILY_STATS_COLLECTION = 'dailyStats';
const EVENT_GUARD_COLLECTION = 'stats_events';
const GUARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const KDS_MIRROR_TTL_MS = 10 * 24 * 60 * 60 * 1000;
const MAX_TELEGRAM_RETRY_AGE_MS = 10 * 60 * 1000;

/**
 * Returns true when an order stopped being visible to KDS and its mirror doc
 * must be deleted. Returns false when neither `before` nor `after` was visible
 * (e.g. unpaid GCash lifecycle writes), avoiding an unnecessary transaction.
 */
export function shouldDeleteKdsMirror(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined,
): boolean {
  return Boolean(before && isOrderVisibleInKds(before) && !(after && isOrderVisibleInKds(after)));
}

/**
 * Returns true when an order first becomes visible to the kitchen (immediately
 * on create for Cash/Staff orders, or upon payment confirmation for GCash).
 */
export function shouldNotifyKitchen(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined,
): boolean {
  return Boolean(
    after &&
    after.status !== 'Cancelled' &&
    isOrderVisibleInKds(after) &&
    (!before || !isOrderVisibleInKds(before)),
  );
}

/**
 * Returns true when an online GCash order transitions to `paymentStatus: 'PAID'`
 * (including late payments on already-cancelled orders so refund alerts retry durably).
 */
export function shouldNotifyPaymentConfirmed(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined,
): boolean {
  return Boolean(
    after &&
    String(after.paymentMethod || '').toLowerCase() === 'gcash' &&
    after.paymentStatus === 'PAID' &&
    before?.paymentStatus !== 'PAID',
  );
}
/**
 * Keeps derived views and notifications in step with `orders/{id}`:
 *  - `kds_orders/{id}`: staff-readable projection for real-time KDS.
 *  - `dailyStats/{date}`: per-day sales totals for reports.
 *  - Telegram new-order notification (on create, atomically deduplicated).
 * Retries on transient errors (`retry: true`).
 */
export const onOrderWritten = onDocumentWritten(
  {
    document: 'orders/{orderId}',
    retry: true,
    timeoutSeconds: 45,
    secrets: [telegramToken, telegramChatIds, googleMapsApiKey],
  },
  async (event) => {
    const db = getFirestore();
    const orderId = event.params.orderId;
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;

    const mirrorRef = db.collection(KDS_COLLECTION).doc(orderId);
    const eventTimeMs = (() => {
      const parsed = event.time ? Date.parse(event.time) : NaN;
      return Number.isFinite(parsed) ? parsed : Date.now();
    })();
    const mirror = (async () => {
      const shouldExist = Boolean(after && isOrderVisibleInKds(after));
      if (shouldExist) {
        const next = kdsMirrorDoc(orderId, after!);
        if (
          before &&
          isOrderVisibleInKds(before) &&
          JSON.stringify(kdsMirrorDoc(orderId, before)) === JSON.stringify(next)
        ) {
          return;
        }
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(mirrorRef);
          const prevMs = snap.exists ? Number(snap.data()?.sourceEventMs) : 0;
          if (Number.isFinite(prevMs) && prevMs > eventTimeMs) return;
          tx.set(mirrorRef, {
            ...next,
            sourceEventMs: eventTimeMs,
            expireAt: Timestamp.fromMillis(eventTimeMs + KDS_MIRROR_TTL_MS),
          });
        });
        return;
      }
      if (!shouldDeleteKdsMirror(before, after)) return;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(mirrorRef);
        if (!snap.exists) return;
        const prevMs = Number(snap.data()?.sourceEventMs);
        if (Number.isFinite(prevMs) && prevMs > eventTimeMs) return;
        tx.delete(mirrorRef);
      });
    })();

    const deltas = dayDeltas(before, after);
    const stats = deltas.size === 0 ? Promise.resolve() : db.runTransaction(async (tx) => {
      const guard = db.collection(EVENT_GUARD_COLLECTION).doc(event.id);
      if ((await tx.get(guard)).exists) return;
      tx.create(guard, {
        orderId,
        at: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + GUARD_TTL_MS),
      });
      for (const [date, delta] of deltas) {
        tx.set(db.collection(DAILY_STATS_COLLECTION).doc(date), incrementPayload(delta), { merge: true });
      }
    });

    const notifyTooOld = Date.now() - eventTimeMs > MAX_TELEGRAM_RETRY_AGE_MS;
    const notify = shouldNotifyKitchen(before, after)
      ? (!hasTelegramConfig()
          ? Promise.resolve().then(() => {
              logger.warn(`Skipping Telegram notification for ${orderId}: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not configured`);
            })
          : notifyTooOld
            ? Promise.resolve().then(() => {
                logger.warn(`Deferring stale Telegram notification retry for ${orderId} (event age > 10m) to scheduled reconciler`);
              })
            : notifyOrderOnce(orderId, after!).then((res) => {
                if (res.inFlight) {
                  throw new Error(`Telegram notification for ${orderId} is still in-flight; retrying until settled`);
                }
              }).catch((err) => {
                if (isPermanentTelegramError(err)) {
                  logger.warn(`Dropping permanent Telegram error for ${orderId} to avoid retry loop`, err);
                  return;
                }
                throw err;
              }))
      : Promise.resolve();

    const notifyPayment = (shouldNotifyPaymentConfirmed(before, after) && hasTelegramConfig())
      ? (notifyTooOld
          ? Promise.resolve().then(() => {
              logger.warn(`Skipping stale Telegram payment retry for ${orderId} (event age > 10m)`);
            })
          : notifyPaymentConfirmedOnce(orderId, after!).then((res) => {
              if (res.inFlight) {
                throw new Error(`Telegram payment notification for ${orderId} is still in-flight; retrying until settled`);
              }
            }).catch((err) => {
              if (isPermanentTelegramError(err)) {
                logger.warn(`Dropping permanent Telegram payment error for ${orderId} to avoid retry loop`, err);
                return;
              }
              throw err;
            }))
      : Promise.resolve();

    const results = await Promise.allSettled([mirror, stats, notify, notifyPayment]);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length) {
      for (const f of failed) logger.error(`Derived order views failed for ${orderId}`, f.reason);
      throw failed[0].reason;
    }
  },
);
