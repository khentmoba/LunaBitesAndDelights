import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { aggregateDailySales, salesReportMessage } from './aggregator';
import { sendToAll } from '../telegram_api';
import { telegramToken, telegramChatIds } from '../secrets';
import { phtDateLabel } from '../util';
import { requireStaff, enforceFixedWindowRateLimit } from '../util/security';
import { logger } from 'firebase-functions';

const MANUAL_REPORT_WINDOW_MS = 5 * 60 * 1000;
const MANUAL_REPORT_MAX = 2;

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
      const dateLabel = phtDateLabel();
      const report = await aggregateDailySales(dateLabel);
      if (!report) return { success: false, message: 'No orders found for today' };
      await sendToAll(salesReportMessage(report, {
        title: 'Manual Sales Report',
        subtitle: '_\\(Triggered by Staff\\)_',
      }));
      return { success: true, message: 'SUCCESS' };
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      logger.error('Error in triggerManualReport', error);
      throw new HttpsError('internal', 'Failed to send manual sales report');
    }
  });
