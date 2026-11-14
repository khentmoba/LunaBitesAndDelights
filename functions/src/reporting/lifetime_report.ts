import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { phtDateLabel } from '../util';
import { requireStaff } from '../util/security';
import { DayStats, dayFromDoc, daysFromOrders, lifetimeReportFromDays } from './daily_stats';

interface LifeTimeReportParams {
  startDate?: string; // YYYY-MM-DD (optional, default: earliest order)
  endDate?: string;   // YYYY-MM-DD (optional, default: today)
}

/** Written by scripts/backfill-derived-views.js once dailyStats covers all past orders. */
export const STATS_META_DOC = 'stats_meta/dailyStats';

export const getLifetimeSalesReport = onCall(async (request) => {
  requireStaff(request);
  const db = getFirestore();
  try {
    const params = (request.data || {}) as LifeTimeReportParams;
    const todayLabel = phtDateLabel();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if ((params.startDate && !dateRe.test(params.startDate)) ||
        (params.endDate && !dateRe.test(params.endDate))) {
      throw new HttpsError('invalid-argument', 'Dates must be YYYY-MM-DD');
    }

    const effectiveStart = params.startDate || '2020-01-01';
    const effectiveEnd = params.endDate || todayLabel;
    const isAllTime = params.startDate === undefined && params.endDate === undefined;
    const dateRange = { start: effectiveStart, end: effectiveEnd, isAllTime };

    const meta = await db.doc(STATS_META_DOC).get();
    let days: Iterable<DayStats>;
    if (meta.exists && meta.get('backfilledAt')) {
      // One small doc per trading day instead of every order.
      const statsRef = db.collection('dailyStats');
      const snap = await (isAllTime
        ? statsRef
        : statsRef.where('date', '>=', effectiveStart).where('date', '<=', effectiveEnd)
      ).get();
      days = snap.docs.map((d) => dayFromDoc(d.id, d.data()));
      logger.info(`Lifetime report ${effectiveStart}..${effectiveEnd} from ${snap.size} dailyStats docs`);
    } else {
      // Not backfilled yet: scan orders as before.
      const ordersRef = db.collection('orders');
      const snap = await (isAllTime
        ? ordersRef
        : ordersRef.where('dateLabel', '>=', effectiveStart).where('dateLabel', '<=', effectiveEnd)
      ).get();
      days = daysFromOrders(snap.docs.map((d) => d.data())).values();
      logger.info(`Lifetime report ${effectiveStart}..${effectiveEnd} from ${snap.size} orders (dailyStats not backfilled)`);
    }

    return lifetimeReportFromDays(days, dateRange);
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    logger.error('Error getting lifetime sales report:', error);
    throw new HttpsError('internal', 'Failed to retrieve lifetime sales report');
  }
});
