import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { aggregateDailySales, salesReportMessage } from './aggregator';
import { sendToAll, escapeMd } from '../telegram_api';
import { phtDateLabel } from '../util';
import { telegramToken, telegramChatIds } from '../secrets';
import { logger } from 'firebase-functions';

const DAILY_REPORTS_SENT_COLLECTION = 'daily_reports_sent';
const DAILY_REPORT_CLAIM_TTL_MS = 5 * 60 * 1000;
const DAILY_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function canClaimDailyReport(
  current: Record<string, any> | undefined,
  nowMs = Date.now(),
): boolean {
  if (!current) return true;
  if (current.status === 'sent') return false;
  if (current.status === 'sending') {
    const claimedAt = current.claimedAt;
    if (typeof claimedAt === 'number' && Number.isFinite(claimedAt) && nowMs - claimedAt < DAILY_REPORT_CLAIM_TTL_MS) {
      return false;
    }
  }
  return true;
}

export const dailySalesReport = onSchedule({
  schedule: '0 22 * * *', // 10 PM
  timeZone: 'Asia/Manila',
  memory: '256MiB',
  secrets: [telegramToken, telegramChatIds],
}, async () => {
  const dateLabel = phtDateLabel();
  const db = getFirestore();
  const guardRef = db.collection(DAILY_REPORTS_SENT_COLLECTION).doc(dateLabel);
  const nowMs = Date.now();
  const expireAt = Timestamp.fromMillis(nowMs + DAILY_REPORT_TTL_MS);

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(guardRef);
    const existing = snap.exists ? snap.data() : undefined;
    if (!canClaimDailyReport(existing, nowMs)) return false;
    tx.set(guardRef, { status: 'sending', claimedAt: nowMs, expireAt }, { merge: true });
    return true;
  });

  if (!claimed) {
    logger.info(`Daily report for ${dateLabel} already sent or in-flight; skipping duplicate run`);
    return;
  }

  logger.info(`Running daily report for ${dateLabel}`);
  try {
    const report = await aggregateDailySales(dateLabel);
    if (!report) {
      await sendToAll(`📊 *Daily Sales Report — ${escapeMd(dateLabel)}*\n\n_No orders recorded today\\._`);
    } else {
      await sendToAll(salesReportMessage(report, {
        title: 'Daily Sales Report',
        footer: '✅ _All records persisted to Firestore_',
      }));
    }
    await guardRef.set({ status: 'sent', sentAt: Date.now() }, { merge: true });
  } catch (err) {
    await guardRef.set({ status: 'failed' }, { merge: true }).catch(() => {});
    throw err;
  }
});
