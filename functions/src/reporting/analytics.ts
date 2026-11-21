import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { phtDateLabel, emptyChannel, addToChannel, isCountableOrder, itemKey } from '../util';
import { requireStaff } from '../util/security';
import { dayFromDoc, emptyDay, isDailyStatsBackfilled, salesAnalyticsFromDay } from './daily_stats';

export const getSalesAnalytics = onCall(async (request) => {
  requireStaff(request);
  const db = getFirestore();
  try {
    const dateLabel = phtDateLabel();
    logger.info(`Fetching sales analytics for dateLabel: ${dateLabel}`);

    const [backfilled, daySnap] = await Promise.all([
      isDailyStatsBackfilled(db),
      db.collection('dailyStats').doc(dateLabel).get(),
    ]);
    if (backfilled) {
      const day = daySnap.exists ? dayFromDoc(dateLabel, daySnap.data()!) : emptyDay(dateLabel);
      return salesAnalyticsFromDay(dateLabel, day);
    }

    const snapshot = await db.collection('orders')
      .where('dateLabel', '==', dateLabel)
      .get();

    let totalRevenue = 0;
    let totalItemsSold = 0;
    let orderCount = 0;
    const channel = emptyChannel();
    const itemCounts: { [key: string]: number } = {};

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!isCountableOrder(data)) continue;
      orderCount += 1;
      const totalAmount = data.totalAmount || 0;
      totalRevenue += totalAmount;
      addToChannel(channel, data.type || 'Pickup', totalAmount);

      for (const item of data.items || []) {
        const name = item.name || 'Unknown';
        const key = itemKey(name, item.variant);
        const qty = Number(item.quantity || item.qty) || 1;
        totalItemsSold += qty;
        itemCounts[key] = (itemCounts[key] || 0) + qty;
      }
    }

    const topItems = Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      success: true,
      dateLabel,
      totalRevenue,
      totalItemsSold,
      orderCount,
      averageOrderValue: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
      breakdown: {
        walkIn: channel.walkIn,
        delivery: channel.delivery,
        pickup: channel.pickup,
      },
      topItems
    };
  } catch (error: any) {
    logger.error('Error getting sales analytics:', error);
    throw new HttpsError('internal', 'Failed to retrieve sales analytics');
  }
});
