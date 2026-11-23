import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { aggregateDailySales, salesReportMessage } from './aggregator';
import { sendToAll } from '../telegram_api';
import { telegramToken, telegramChatIds } from '../secrets';
import { phtDateLabel } from '../util';
import { requireStaff, enforceFixedWindowRateLimit } from '../util/security';
import { logger } from 'firebase-functions';

const MANUAL_REPORT_WINDOW_MS = 5 * 60 * 1000;
const MANUAL_REPORT_MAX = 2;
const MANUAL_REPORT_GUARD_COLLECTION = 'daily_reports_sent';
const MANUAL_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Guard doc for one day's manual report; kept apart from the scheduled report's date doc. */
export const manualReportGuardId = (dateLabel: string): string => `manual-${dateLabel}`;

export interface ManualReportOutcome {
  sent: boolean;
  message: string;
  /** Chats already carrying this day's report, skipped so a retry cannot spam them. */
  skippedChats: number;
}

function deliveredIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

/**
 * Sends today's sales summary to every Telegram chat. A partial delivery is
 * persisted, so retrying after a transient failure only reaches the chats that
 * did not get the report — the scheduled report already behaves this way.
 */
export async function runManualSalesReport(
  dateLabel = phtDateLabel(),
  opts: { db?: Firestore; aggregate?: typeof aggregateDailySales } = {},
): Promise<ManualReportOutcome> {
  const db = opts.db ?? getFirestore();
  const aggregate = opts.aggregate ?? aggregateDailySales;

  const report = await aggregate(dateLabel);
  if (!report) return { sent: false, message: 'No orders found for today', skippedChats: 0 };

  const guardRef = db.collection(MANUAL_REPORT_GUARD_COLLECTION).doc(manualReportGuardId(dateLabel));
  const guard = await guardRef.get().catch(() => null);
  const guardData = guard?.exists ? guard.data() : undefined;
  // Only a *failed* attempt's partial deliveries are skipped. A deliberate
  // second report of the day (status 'sent') must still reach every chat.
  const alreadyDelivered = guardData?.status === 'failed' ? deliveredIds(guardData.deliveredChatIds) : [];
  const expireAt = Timestamp.fromMillis(Date.now() + MANUAL_REPORT_TTL_MS);

  const message = salesReportMessage(report, {
    title: 'Manual Sales Report',
    subtitle: '_\\(Triggered by Staff\\)_',
  });

  try {
    await sendToAll(message, { skipChatIds: alreadyDelivered });
    await guardRef.set(
      { status: 'sent', deliveredChatIds: [], sentAt: Date.now(), expireAt },
      { merge: true },
    ).catch((err) => {
      logger.warn(`Manual report for ${dateLabel} sent but its guard doc could not be updated`, err);
    });
    return { sent: true, message: 'SUCCESS', skippedChats: alreadyDelivered.length };
  } catch (err: any) {
    await guardRef.set(
      {
        status: 'failed',
        deliveredChatIds: Array.from(new Set([...alreadyDelivered, ...deliveredIds(err?.deliveredChatIds)])),
        expireAt,
      },
      { merge: true },
    ).catch((e) => {
      logger.warn(`Could not record partial manual report delivery for ${dateLabel}`, e);
    });
    throw err;
  }
}

export const triggerManualReport = onCall(
  { secrets: [telegramToken, telegramChatIds] },
  async (request) => {
    const uid = requireStaff(request);
    await enforceFixedWindowRateLimit(
      `report:manual:${uid}`,
      MANUAL_REPORT_MAX,
      MANUAL_REPORT_WINDOW_MS,
      'Manual report was just sent. Please wait a few minutes before sending again.',
    );
    logger.info('Manual report triggered');
    try {
      const result = await runManualSalesReport();
      if (!result.sent) return { success: false, message: result.message };
      return { success: true, message: result.message };
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      logger.error('Error in triggerManualReport', error);
      throw new HttpsError('internal', 'Failed to send manual sales report');
    }
  });
