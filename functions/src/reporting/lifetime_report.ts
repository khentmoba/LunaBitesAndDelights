import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { phtDateLabel, itemKey, emptyChannel, addToChannel, isCountableOrder, ChannelBucket } from '../util';
import { requireStaff } from '../util/security';

interface LifeTimeReportParams {
  startDate?: string; // YYYY-MM-DD (optional, default: earliest order)
  endDate?: string;   // YYYY-MM-DD (optional, default: today)
}

const zero = (): ChannelBucket => ({ revenue: 0, count: 0 });

export const getLifetimeSalesReport = onCall(async (request) => {
  requireStaff(request);
  const db = getFirestore();
  try {
    const params = request.data as LifeTimeReportParams;
    const todayLabel = phtDateLabel();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if ((params.startDate && !dateRe.test(params.startDate)) ||
        (params.endDate && !dateRe.test(params.endDate))) {
      throw new HttpsError('invalid-argument', 'Dates must be YYYY-MM-DD');
    }

    const effectiveStart = params.startDate || '2020-01-01';
    const effectiveEnd = params.endDate || todayLabel;
    const isAllTime = params.startDate === undefined && params.endDate === undefined;

    logger.info(`Fetching lifetime sales report from ${effectiveStart} to ${effectiveEnd}`);

    // dateLabel is 'YYYY-MM-DD', so string range queries work.
    const ordersRef = db.collection('orders');
    const query = isAllTime
      ? ordersRef
      : ordersRef
          .where('dateLabel', '>=', effectiveStart)
          .where('dateLabel', '<=', effectiveEnd);

    const snapshot = await query.get();

    let totalRevenue = 0;
    let totalItemsSold = 0;
    let orderCount = 0;
    const channel = emptyChannel();
    const kiosk = zero();
    const staff = zero();
    const cash = zero();
    const gcash = zero();

    const itemCounts: { [key: string]: { name: string; variant: string; quantity: number; revenue: number } } = {};
    const dailyRevenue: { [dateLabel: string]: number } = {};
    const dailyOrders: { [dateLabel: string]: number } = {};

    const add = (b: ChannelBucket, amount: number) => {
      b.revenue += amount;
      b.count += 1;
    };

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!isCountableOrder(data)) continue;
      orderCount += 1;
      const totalAmount = data.totalAmount || 0;
      const dateLabel = data.dateLabel || 'unknown';

      totalRevenue += totalAmount;
      addToChannel(channel, data.type || 'Pickup', totalAmount);
      add(data.entryType === 'Staff' ? staff : kiosk, totalAmount);
      add(String(data.paymentMethod || 'Cash').toLowerCase() === 'gcash' ? gcash : cash, totalAmount);

      dailyRevenue[dateLabel] = (dailyRevenue[dateLabel] || 0) + totalAmount;
      dailyOrders[dateLabel] = (dailyOrders[dateLabel] || 0) + 1;

      for (const item of data.items || []) {
        const name = item.name || 'Unknown';
        const variant = item.variant || '';
        const qty = item.quantity || 1;
        totalItemsSold += qty;

        const key = itemKey(name, variant);
        if (!itemCounts[key]) {
          itemCounts[key] = { name, variant, quantity: 0, revenue: 0 };
        }
        itemCounts[key].quantity += qty;
        itemCounts[key].revenue += (item.price || 0) * qty;
      }
    }

    const topItems = Object.values(itemCounts)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 20)
      .map((item, index) => ({
        rank: index + 1,
        name: itemKey(item.name, item.variant),
        quantity: item.quantity,
        revenue: item.revenue,
      }));

    const dailySeries = Object.entries(dailyRevenue)
      .map(([date, revenue]) => ({
        date,
        revenue,
        orders: dailyOrders[date] || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      success: true,
      dateRange: {
        start: effectiveStart,
        end: effectiveEnd,
        isAllTime,
      },
      summary: {
        totalRevenue,
        orderCount,
        averageOrderValue: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
        totalItemsSold,
      },
      breakdown: {
        channel: {
          walkIn: channel.walkIn,
          delivery: channel.delivery,
          pickup: channel.pickup,
        },
        entryType: { kiosk, staff },
        paymentMethod: { cash, gcash },
      },
      topItems,
      dailySeries,
    };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    logger.error('Error getting lifetime sales report:', error);
    throw new HttpsError('internal', 'Failed to retrieve lifetime sales report');
  }
});
