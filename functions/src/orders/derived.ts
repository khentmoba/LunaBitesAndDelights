import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { projectOrder, isOrderVisibleInKds, toIsoTimestamp } from './kds';
import { notifyOrderOnce } from './send_notification';
import { dayDeltas, incrementPayload } from '../reporting/daily_stats';
import { telegramToken, telegramChatIds, googleMapsApiKey } from '../secrets';

export const KDS_COLLECTION = 'kds_orders';
export const DAILY_STATS_COLLECTION = 'dailyStats';
const EVENT_GUARD_COLLECTION = 'stats_events';
const GUARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Kitchen-screen mirror doc: the same trimmed projection the callable returns, plus a queryable time. */
export function kdsMirrorDoc(id: string, data: FirebaseFirestore.DocumentData) {
  const ts = data.timestamp instanceof Timestamp
    ? data.timestamp
    : Timestamp.fromDate(new Date(toIsoTimestamp(data.timestamp)));
  return { ...projectOrder(id, data), ts };
}

function hasTelegramConfig(): boolean {
  try {
    return telegramToken.value().trim().length > 0 && telegramChatIds.value().trim().length > 0;
  } catch {
    return false;
  }
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
    secrets: [telegramToken, telegramChatIds, googleMapsApiKey],
  },
  async (event) => {
    const db = getFirestore();
    const orderId = event.params.orderId;
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;

    const mirrorRef = db.collection(KDS_COLLECTION).doc(orderId);
    const mirror = (async () => {
      if (!after || !isOrderVisibleInKds(after)) return mirrorRef.delete();
      const next = kdsMirrorDoc(orderId, after);
      if (
        before &&
        isOrderVisibleInKds(before) &&
        JSON.stringify(kdsMirrorDoc(orderId, before)) === JSON.stringify(next)
      ) {
        return;
      }
      return mirrorRef.set(next);
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

    const notify = (!before && after && hasTelegramConfig())
      ? notifyOrderOnce(orderId, after)
      : Promise.resolve();

    const results = await Promise.allSettled([mirror, stats, notify]);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length) {
      for (const f of failed) logger.error(`Derived order views failed for ${orderId}`, f.reason);
      throw failed[0].reason;
    }
  },
);
