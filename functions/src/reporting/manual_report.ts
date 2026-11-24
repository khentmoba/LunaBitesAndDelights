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
const MANUAL_REPORT_CLAIM_TTL_MS = 60 * 1000;
const MANUAL_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Guard doc for one day's manual report; kept apart from the scheduled report's date doc. */
export const manualReportGuardId = (dateLabel: string): string => `manual-${dateLabel}`;

export interface ManualReportOutcome {
  sent: boolean;
  inFlight?: boolean;
  message: string;
  /** Chats already carrying this day's report, skipped so a retry cannot spam them. */
  skippedChats: number;
}

export type ManualReportClaimStatus = 'claimed' | 'in-flight';

/** Returns 'in-flight' when another manual report send holds an unexpired lease. */
export function evaluateManualReportClaim(
  current: Record<string, any> | undefined,
  nowMs = Date.now(),
): ManualReportClaimStatus {
  if (current?.status === 'sending') {
    const claimedAt = current.claimedAt;
    if (typeof claimedAt === 'number' && Number.isFinite(claimedAt) && nowMs - claimedAt < MANUAL_REPORT_CLAIM_TTL_MS) {
      return 'in-flight';
    }
  }
  return 'claimed';
}

function deliveredIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

/**
 * Sends today's sales summary to every Telegram chat. Claims an atomic lease so
 * concurrent triggers cannot double-send, and persists partial deliveries so
 * retrying after a transient failure only reaches the chats that missed it.
 */
export async function runManualSalesReport(
  dateLabel = phtDateLabel(),
  opts: {
    db?: Firestore;
    aggregate?: typeof aggregateDailySales;
    persistBackoffMs?: number[];
  } = {},
): Promise<ManualReportOutcome> {
  const db = opts.db ?? getFirestore();
  const aggregate = opts.aggregate ?? aggregateDailySales;

  const report = await aggregate(dateLabel);
  if (!report) return { sent: false, message: 'No orders found for today', skippedChats: 0 };

  const guardRef = db.collection(MANUAL_REPORT_GUARD_COLLECTION).doc(manualReportGuardId(dateLabel));
  const nowMs = Date.now();
  const expireAt = Timestamp.fromMillis(nowMs + MANUAL_REPORT_TTL_MS);

  const { status: claimStatus, alreadyDelivered } = await db.runTransaction<{
    status: ManualReportClaimStatus;
    alreadyDelivered: string[];
  }>(async (tx) => {
    const snap = await tx.get(guardRef);
    const guardData = snap.exists ? snap.data() : undefined;
    const status = evaluateManualReportClaim(guardData, nowMs);
    if (status === 'in-flight') {
      return { status, alreadyDelivered: [] };
    }
    // Only a *failed* or expired-in-flight attempt's partial deliveries are
    // skipped. A deliberate second report after status 'sent' reaches every chat.
    const carryForward = guardData?.status === 'failed' || guardData?.status === 'sending'
      ? deliveredIds(guardData.deliveredChatIds)
      : [];
    tx.set(
      guardRef,
      { status: 'sending', claimedAt: nowMs, deliveredChatIds: carryForward, expireAt },
      { merge: true },
    );
    return { status, alreadyDelivered: carryForward };
  });

  if (claimStatus === 'in-flight') {
    logger.warn(`Manual report for ${dateLabel} is already in-flight; skipping duplicate send`);
    return {
      sent: false,
      inFlight: true,
      message: 'Manual sales report is already being sent.',
      skippedChats: 0,
    };
  }

  const message = salesReportMessage(report, {
    title: 'Manual Sales Report',
    subtitle: '_\\(Triggered by Staff\\)_',
  });

  let newlyDelivered: string[];
  try {
    const result = await sendToAll(message, { skipChatIds: alreadyDelivered });
    newlyDelivered = deliveredIds(result?.deliveredChatIds);
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

  // Keep the delivered chats on the guard even on success. Deliberate later
  // reports still reach everyone (status 'sent' clears carry-forward), but if
  // every sent-state write fails the stale 'sending' lease must not re-send to
  // chats that already got this report once it expires.
  const allDelivered = Array.from(new Set([...alreadyDelivered, ...newlyDelivered]));
  const sentPayload = { status: 'sent', deliveredChatIds: allDelivered, sentAt: Date.now(), expireAt };
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
      `Manual report for ${dateLabel} sent but its guard doc could not be updated after ${persistBackoffMs.length} attempts`,
      { error: lastPersistErr },
    );
    // The guard is still 'sending'. Remember who got this report so a retry
    // after the lease expires skips them instead of sending it a second time.
    await guardRef.set({ deliveredChatIds: allDelivered, expireAt }, { merge: true }).catch((e) => {
      logger.warn(`Could not record delivered chats for manual report ${dateLabel}`, e);
    });
  }
  return { sent: true, message: 'SUCCESS', skippedChats: alreadyDelivered.length };
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
      if (!result.sent) {
        return {
          success: false,
          ...(result.inFlight ? { inFlight: true } : {}),
          message: result.message,
        };
      }
      return { success: true, message: result.message };
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      logger.error('Error in triggerManualReport', error);
      throw new HttpsError('internal', 'Failed to send manual sales report');
    }
  });
