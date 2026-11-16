import { onSchedule } from 'firebase-functions/v2/scheduler';
import { aggregateDailySales, salesReportMessage } from './aggregator';
import { sendToAll, escapeMd } from '../telegram_api';
import { phtDateLabel } from '../util';
import { telegramToken, telegramChatIds } from '../secrets';
import { logger } from 'firebase-functions';

export const dailySalesReport = onSchedule({
  schedule: '0 22 * * *', // 10 PM
  timeZone: 'Asia/Manila',
  memory: '256MiB',
  secrets: [telegramToken, telegramChatIds],
}, async () => {
  const dateLabel = phtDateLabel();
  logger.info(`Running daily report for ${dateLabel}`);

  const report = await aggregateDailySales(dateLabel);

  if (!report) {
    await sendToAll(`📊 *Daily Sales Report — ${escapeMd(dateLabel)}*\n\n_No orders recorded today\\._`);
    return;
  }

  await sendToAll(salesReportMessage(report, {
    title: 'Daily Sales Report',
    footer: '✅ _All records persisted to Firestore_',
  }));
});
