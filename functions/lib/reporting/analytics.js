"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSalesAnalytics = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const util_1 = require("../util");
const security_1 = require("../util/security");
exports.getSalesAnalytics = (0, https_1.onCall)(async (request) => {
    (0, security_1.requireStaff)(request);
    const db = (0, firestore_1.getFirestore)();
    try {
        const dateLabel = (0, util_1.phtDateLabel)();
        firebase_functions_1.logger.info(`Fetching sales analytics for dateLabel: ${dateLabel}`);
        const snapshot = await db.collection('orders')
            .where('dateLabel', '==', dateLabel)
            .get();
        let totalRevenue = 0;
        let totalItemsSold = 0;
        let orderCount = 0;
        const channel = (0, util_1.emptyChannel)();
        const itemCounts = {};
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (!(0, util_1.isCountableOrder)(data))
                continue;
            orderCount += 1;
            const totalAmount = data.totalAmount || 0;
            totalRevenue += totalAmount;
            (0, util_1.addToChannel)(channel, data.type || 'Pickup', totalAmount);
            for (const item of data.items || []) {
                const name = item.name || 'Unknown';
                const qty = Number(item.quantity || item.qty || 1);
                totalItemsSold += qty;
                itemCounts[name] = (itemCounts[name] || 0) + qty;
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
    }
    catch (error) {
        firebase_functions_1.logger.error('Error getting sales analytics:', error);
        throw new https_1.HttpsError('internal', 'Failed to retrieve sales analytics');
    }
});
//# sourceMappingURL=analytics.js.map