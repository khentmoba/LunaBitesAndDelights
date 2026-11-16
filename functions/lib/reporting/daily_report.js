"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailySalesReport = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const aggregator_1 = require("./aggregator");
const telegram_api_1 = require("../telegram_api");
const util_1 = require("../util");
const secrets_1 = require("../secrets");
const firebase_functions_1 = require("firebase-functions");
exports.dailySalesReport = (0, scheduler_1.onSchedule)({
    schedule: '0 22 * * *', // 10 PM
    timeZone: 'Asia/Manila',
    memory: '256MiB',
    secrets: [secrets_1.telegramToken, secrets_1.telegramChatIds],
}, async () => {
    const dateLabel = (0, util_1.phtDateLabel)();
    firebase_functions_1.logger.info(`Running daily report for ${dateLabel}`);
    const report = await (0, aggregator_1.aggregateDailySales)(dateLabel);
    if (!report) {
        await (0, telegram_api_1.sendToAll)(`📊 *Daily Sales Report — ${(0, telegram_api_1.escapeMd)(dateLabel)}*\n\n_No orders recorded today\\._`);
        return;
    }
    await (0, telegram_api_1.sendToAll)((0, aggregator_1.salesReportMessage)(report, {
        title: 'Daily Sales Report',
        footer: '✅ _All records persisted to Firestore_',
    }));
});
//# sourceMappingURL=daily_report.js.map