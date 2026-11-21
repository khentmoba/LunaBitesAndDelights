import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldPath, Query, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { phtDateLabel } from '../util';
import { requireStaff } from '../util/security';
import {
  DayStats, applyToDay, contributionOf, dayFromDoc, emptyDay,
  isDailyStatsBackfilled, lifetimeReportFromDays, STATS_META_DOC,
} from './daily_stats';

export { STATS_META_DOC };

const FALLBACK_PAGE_SIZE = 1000;
const MAX_FALLBACK_PAGES = 20;

interface LifeTimeReportParams {
  startDate?: string; // YYYY-MM-DD (optional, default: earliest order)
  endDate?: string;   // YYYY-MM-DD (optional, default: today)
}

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

    const backfilled = await isDailyStatsBackfilled(db);
    let days: Iterable<DayStats>;
    if (backfilled) {
      // One small doc per trading day instead of every order.
      const statsRef = db.collection('dailyStats');
      const snap = await (isAllTime
        ? statsRef
        : statsRef.where('date', '>=', effectiveStart).where('date', '<=', effectiveEnd)
      ).get();
      days = snap.docs.map((d) => dayFromDoc(d.id, d.data()));
      logger.info(`Lifetime report ${effectiveStart}..${effectiveEnd} from ${snap.size} dailyStats docs`);
    } else {
      // Not backfilled yet: paginate orders in bounded batches to avoid loading the whole collection at once.
      const ordersRef = db.collection('orders');
      const baseQuery = isAllTime
        ? ordersRef.orderBy(FieldPath.documentId())
        : ordersRef.where('dateLabel', '>=', effectiveStart).where('dateLabel', '<=', effectiveEnd).orderBy('dateLabel');
      const dayMap = new Map<string, DayStats>();
      let lastDoc: QueryDocumentSnapshot | null = null;
      let totalScanned = 0;
      let pages = 0;
      for (;;) {
        if (pages >= MAX_FALLBACK_PAGES) {
          throw new HttpsError(
            'failed-precondition',
            'Order history exceeds fallback scan limit. Run backfill-derived-views to enable dailyStats.',
          );
        }
        pages += 1;
        const pageQuery: Query = lastDoc
          ? baseQuery.startAfter(lastDoc).limit(FALLBACK_PAGE_SIZE)
          : baseQuery.limit(FALLBACK_PAGE_SIZE);
        const snap: QuerySnapshot = await pageQuery.get();
        if (snap.empty) break;
        totalScanned += snap.size;
        for (const doc of snap.docs) {
          const c = contributionOf(doc.data());
          if (!c) continue;
          let day = dayMap.get(c.date);
          if (!day) dayMap.set(c.date, (day = emptyDay(c.date)));
          applyToDay(day, c, 1);
        }
        if (snap.size < FALLBACK_PAGE_SIZE) break;
        lastDoc = snap.docs[snap.docs.length - 1];
      }
      days = dayMap.values();
      logger.info(`Lifetime report ${effectiveStart}..${effectiveEnd} from ${totalScanned} orders (dailyStats not backfilled)`);
    }

    return lifetimeReportFromDays(days, dateRange);
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    logger.error('Error getting lifetime sales report:', error);
    throw new HttpsError('internal', 'Failed to retrieve lifetime sales report');
  }
});
