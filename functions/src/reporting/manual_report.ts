import { onCall } from 'firebase-functions/v2/https';
import { aggregateDailySales, salesReportMessage } from './aggregator';
import { sendToAll } from '../telegram_api';
import { telegramToken, telegramChatIds } from '../secrets';
import { phtDateLabel } from '../util';
import { requireStaff } from '../util/security';
import { logger } from 'firebase-functions';

export const triggerManualReport = onCall(
  { secrets: [telegramToken, telegramChatIds] },
  async (request) => {
    requireStaff(request);
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
      logger.error('Error in triggerManualReport', error);
      return { success: false, message: 'Internal server error' };
    }
  });
