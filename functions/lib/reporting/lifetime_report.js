"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLifetimeSalesReport = exports.STATS_META_DOC = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const util_1 = require("../util");
const security_1 = require("../util/security");
const daily_stats_1 = require("./daily_stats");
/** Written by scripts/backfill-derived-views.js once dailyStats covers all past orders. */
exports.STATS_META_DOC = 'stats_meta/dailyStats';
exports.getLifetimeSalesReport = (0, https_1.onCall)(async (request) => {
    (0, security_1.requireStaff)(request);
    const db = (0, firestore_1.getFirestore)();
    try {
        const params = (request.data || {});
        const todayLabel = (0, util_1.phtDateLabel)();
        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        if ((params.startDate && !dateRe.test(params.startDate)) ||
            (params.endDate && !dateRe.test(params.endDate))) {
            throw new https_1.HttpsError('invalid-argument', 'Dates must be YYYY-MM-DD');
        }
        const effectiveStart = params.startDate || '2020-01-01';
        const effectiveEnd = params.endDate || todayLabel;
        const isAllTime = params.startDate === undefined && params.endDate === undefined;
        const dateRange = { start: effectiveStart, end: effectiveEnd, isAllTime };
        const meta = await db.doc(exports.STATS_META_DOC).get();
        let days;
        if (meta.exists && meta.get('backfilledAt')) {
            // One small doc per trading day instead of every order.
            const statsRef = db.collection('dailyStats');
            const snap = await (isAllTime
                ? statsRef
                : statsRef.where('date', '>=', effectiveStart).where('date', '<=', effectiveEnd)).get();
            days = snap.docs.map((d) => (0, daily_stats_1.dayFromDoc)(d.id, d.data()));
            firebase_functions_1.logger.info(`Lifetime report ${effectiveStart}..${effectiveEnd} from ${snap.size} dailyStats docs`);
        }
        else {
            // Not backfilled yet: scan orders as before.
            const ordersRef = db.collection('orders');
            const snap = await (isAllTime
                ? ordersRef
                : ordersRef.where('dateLabel', '>=', effectiveStart).where('dateLabel', '<=', effectiveEnd)).get();
            days = (0, daily_stats_1.daysFromOrders)(snap.docs.map((d) => d.data())).values();
            firebase_functions_1.logger.info(`Lifetime report ${effectiveStart}..${effectiveEnd} from ${snap.size} orders (dailyStats not backfilled)`);
        }
        return (0, daily_stats_1.lifetimeReportFromDays)(days, dateRange);
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        firebase_functions_1.logger.error('Error getting lifetime sales report:', error);
        throw new https_1.HttpsError('internal', 'Failed to retrieve lifetime sales report');
    }
});
//# sourceMappingURL=lifetime_report.js.map