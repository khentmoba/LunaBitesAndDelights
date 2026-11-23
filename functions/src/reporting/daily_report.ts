import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp, Firestore } from 'firebase-admin/firestore';
import { aggregateDailySales, salesReportMessage } from './aggregator';
import { sendToAll, escapeMd, isPermanentTelegramError } from '../telegram_api';
import { phtDateLabel } from '../util';
import { telegramToken, telegramChatIds } from '../secrets';
import { logger } from 'firebase-functions';

const DAILY_REPORTS_SENT_COLLECTION = 'daily_reports_sent';
const DAILY_REPORT_CLAIM_TTL_MS = 5 * 60 * 1000;
const DAILY_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Resolves the scheduled PHT day, even when a retry runs after midnight. */
export function scheduledReportDate(scheduleTime?: string, eventTime?: string, now = new Date()): string {
  for (const raw of [scheduleTime, eventTime]) {
    if (!raw) continue;
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return phtDateLabel(parsed);
  }
  return phtDateLabel(now);
}

export function canClaimDailyReport(
  current: Record<string, any> | undefined,
  nowMs = Date.now(),
): boolean {
  if (!current) return true;
  if (current.status === 'sent' || current.status === 'failed_permanent') return false;
  if (current.status === 'sending') {
    const claimedAt = current.claimedAt;
    if (typeof claimedAt === 'number' && Number.isFinite(claimedAt) && nowMs - claimedAt < DAILY_REPORT_CLAIM_TTL_MS) {
      return false;
    }
  }
  return true;
}

export async function runDailySalesReport(
  dateLabel = phtDateLabel(),
  opts: {
    db?: Firestore;
    persistBackoffMs?: number[];
    aggregate?: typeof aggregateDailySales;
  } = {},
): Promise<{ sent: boolean; skipped?: boolean; permanentFailure?: boolean }> {
  const db = opts.db ?? getFirestore();
  const aggregate = opts.aggregate ?? aggregateDailySales;
  const guardRef = db.collection(DAILY_REPORTS_SENT_COLLECTION).doc(dateLabel);
  const nowMs = Date.now();
  const expireAt = Timestamp.fromMillis(nowMs + DAILY_REPORT_TTL_MS);

  const { claimed, deliveredChatIds } = await db.runTransaction<{
    claimed: boolean;
    deliveredChatIds: string[];
  }>(async (tx) => {
    const snap = await tx.get(guardRef);
    const existing = snap.exists ? snap.data() : undefined;
    const prevDelivered = Array.isArray(existing?.deliveredChatIds)
      ? existing.deliveredChatIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (!canClaimDailyReport(existing, nowMs)) {
      return { claimed: false, deliveredChatIds: prevDelivered };
    }
    tx.set(guardRef, { status: 'sending', claimedAt: nowMs, expireAt }, { merge: true });
    return { claimed: true, deliveredChatIds: prevDelivered };
  });

  if (!claimed) {
    logger.info(`Daily report for ${dateLabel} already sent, permanently failed, or in-flight; skipping duplicate run`);
    return { sent: false, skipped: true };
  }

  logger.info(`Running daily report for ${dateLabel}`);
  let message: string;
  try {
    const report = await aggregate(dateLabel);
    message = !report
      ? `📊 *Daily Sales Report — ${escapeMd(dateLabel)}*\n\n_No orders recorded today\\._`
      : salesReportMessage(report, {
          title: 'Daily Sales Report',
          footer: '✅ _All records persisted to Firestore_',
        });
  } catch (err) {
    await guardRef.set({ status: 'failed' }, { merge: true }).catch(() => {});
    throw err;
  }

  let newlyDelivered: string[];
  try {
    const res = await sendToAll(message, { skipChatIds: deliveredChatIds });
    newlyDelivered = res.deliveredChatIds;
  } catch (err: any) {
    const partialDelivered = Array.isArray(err?.deliveredChatIds)
      ? err.deliveredChatIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const mergedDelivered = Array.from(new Set([...deliveredChatIds, ...partialDelivered]));
    const permanent = isPermanentTelegramError(err);
    await guardRef.set(
      {
        status: permanent ? 'failed_permanent' : 'failed',
        deliveredChatIds: mergedDelivered,
        lastError: String(err?.message || 'unknown').slice(0, 500),
      },
      { merge: true },
    ).catch(() => {});
    if (permanent) {
      logger.warn(`Dropping permanent Telegram error for daily report ${dateLabel}`, err);
      return { sent: false, permanentFailure: true };
    }
    throw err;
  }

  const allDelivered = Array.from(new Set([...deliveredChatIds, ...newlyDelivered]));
  const sentPayload = {
    status: 'sent',
    sentAt: Date.now(),
    deliveredChatIds: allDelivered,
    lastError: null,
  };
  const persistBackoffMs = opts.persistBackoffMs ?? [0, 250, 500, 1000];
  let lastPersistErr: unknown = null;
  for (let attempt = 0; attempt < persistBackoffMs.length; attempt++) {
    if (persistBackoffMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, persistBackoffMs[attempt]));
    }
    try {
      await guardRef.set(sentPayload, { merge: true });
      lastPersistErr = null;
      break;
    } catch (err) {
      lastPersistErr = err;
    }
  }
  if (lastPersistErr !== null) {
    logger.error(
      `Daily sales report sent for ${dateLabel} but failed to persist sent state after ${persistBackoffMs.length} attempts`,
      { error: lastPersistErr },
    );
  }
  return { sent: true };
}

export const dailySalesReport = onSchedule({
  schedule: '0 22 * * *', // 10 PM
  timeZone: 'Asia/Manila',
  memory: '256MiB',
  secrets: [telegramToken, telegramChatIds],
  // A transient aggregation/Telegram failure marks the guard `failed`; the next
  // attempt reclaims it. Without retries, that day's report is never sent.
  retryCount: 3,
}, async (event) => {
  // A delayed retry just after midnight must still report the day the
  // schedule fired for, not the following PHT date.
  await runDailySalesReport(scheduledReportDate(event.scheduleTime));
});
