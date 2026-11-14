"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateDailySales = aggregateDailySales;
exports.salesReportMessage = salesReportMessage;
const firestore_1 = require("firebase-admin/firestore");
const util_1 = require("../util");
const telegram_api_1 = require("../telegram_api");
async function aggregateDailySales(dateLabel) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db.collection('orders')
        .where('dateLabel', '==', dateLabel)
        .get();
    if (snapshot.empty)
        return null;
    let totalSales = 0;
    let kioskSales = 0;
    let staffSales = 0;
    let totalOrders = 0;
    const itemCounts = {};
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!(0, util_1.isCountableOrder)(data))
            return;
        totalOrders += 1;
        const amount = data.totalAmount || 0;
        totalSales += amount;
        if (data.entryType === 'Staff')
            staffSales += amount;
        else
            kioskSales += amount;
        for (const item of data.items || []) {
            const key = (0, util_1.itemKey)(item.name, item.variant);
            itemCounts[key] = (itemCounts[key] || 0) + (item.quantity || 1);
        }
    });
    return {
        date: dateLabel,
        totalSales,
        kioskSales,
        staffSales,
        totalOrders,
        topItems: Object.entries(itemCounts)
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
    };
}
/** Shared Telegram body for the daily and manual sales reports. */
function salesReportMessage(report, opts) {
    const itemsList = report.topItems
        .slice(0, 10)
        .map(i => `  • ${(0, telegram_api_1.escapeMd)(i.name)}: *${i.qty}*`)
        .join('\n');
    return [
        `📊 *${opts.title} — ${(0, telegram_api_1.escapeMd)(report.date)}*`,
        ...(opts.subtitle ? [opts.subtitle] : []),
        '',
        `💰 *Total Sales:* ₱*${(0, telegram_api_1.escapeMd)(report.totalSales.toString())}*`,
        `🛒 *Total Orders:* ${report.totalOrders}`,
        '',
        `🏷 *Breakdown:*`,
        `  • Kiosk Orders: ₱${(0, telegram_api_1.escapeMd)(report.kioskSales.toString())}`,
        `  • Walk\\-in/Staff: ₱${(0, telegram_api_1.escapeMd)(report.staffSales.toString())}`,
        '',
        `🔥 *Top Items:*`,
        itemsList,
        ...(opts.footer ? ['', opts.footer] : []),
    ].join('\n');
}
//# sourceMappingURL=aggregator.js.map