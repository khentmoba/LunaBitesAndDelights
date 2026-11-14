"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLifetimeSalesReport = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const util_1 = require("../util");
const security_1 = require("../util/security");
const zero = () => ({ revenue: 0, count: 0 });
exports.getLifetimeSalesReport = (0, https_1.onCall)(async (request) => {
    (0, security_1.requireStaff)(request);
    const db = (0, firestore_1.getFirestore)();
    try {
        const params = request.data;
        const todayLabel = (0, util_1.phtDateLabel)();
        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        if ((params.startDate && !dateRe.test(params.startDate)) ||
            (params.endDate && !dateRe.test(params.endDate))) {
            throw new https_1.HttpsError('invalid-argument', 'Dates must be YYYY-MM-DD');
        }
        const effectiveStart = params.startDate || '2020-01-01';
        const effectiveEnd = params.endDate || todayLabel;
        const isAllTime = params.startDate === undefined && params.endDate === undefined;
        firebase_functions_1.logger.info(`Fetching lifetime sales report from ${effectiveStart} to ${effectiveEnd}`);
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
        const channel = (0, util_1.emptyChannel)();
        const kiosk = zero();
        const staff = zero();
        const cash = zero();
        const gcash = zero();
        const itemCounts = {};
        const dailyRevenue = {};
        const dailyOrders = {};
        const add = (b, amount) => {
            b.revenue += amount;
            b.count += 1;
        };
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (!(0, util_1.isCountableOrder)(data))
                continue;
            orderCount += 1;
            const totalAmount = data.totalAmount || 0;
            const dateLabel = data.dateLabel || 'unknown';
            totalRevenue += totalAmount;
            (0, util_1.addToChannel)(channel, data.type || 'Pickup', totalAmount);
            add(data.entryType === 'Staff' ? staff : kiosk, totalAmount);
            add(String(data.paymentMethod || 'Cash').toLowerCase() === 'gcash' ? gcash : cash, totalAmount);
            dailyRevenue[dateLabel] = (dailyRevenue[dateLabel] || 0) + totalAmount;
            dailyOrders[dateLabel] = (dailyOrders[dateLabel] || 0) + 1;
            for (const item of data.items || []) {
                const name = item.name || 'Unknown';
                const variant = item.variant || '';
                const qty = item.quantity || 1;
                totalItemsSold += qty;
                const key = (0, util_1.itemKey)(name, variant);
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
            name: (0, util_1.itemKey)(item.name, item.variant),
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
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        firebase_functions_1.logger.error('Error getting lifetime sales report:', error);
        throw new https_1.HttpsError('internal', 'Failed to retrieve lifetime sales report');
    }
});
//# sourceMappingURL=lifetime_report.js.map