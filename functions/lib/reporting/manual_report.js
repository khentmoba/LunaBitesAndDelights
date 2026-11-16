"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerManualReport = void 0;
const https_1 = require("firebase-functions/v2/https");
const aggregator_1 = require("./aggregator");
const telegram_api_1 = require("../telegram_api");
const secrets_1 = require("../secrets");
const util_1 = require("../util");
const security_1 = require("../util/security");
const firebase_functions_1 = require("firebase-functions");
exports.triggerManualReport = (0, https_1.onCall)({ secrets: [secrets_1.telegramToken, secrets_1.telegramChatIds] }, async (request) => {
    (0, security_1.requireStaff)(request);
    firebase_functions_1.logger.info('Manual report triggered');
    try {
        const dateLabel = (0, util_1.phtDateLabel)();
        const report = await (0, aggregator_1.aggregateDailySales)(dateLabel);
        if (!report)
            return { success: false, message: 'No orders found for today' };
        await (0, telegram_api_1.sendToAll)((0, aggregator_1.salesReportMessage)(report, {
            title: 'Manual Sales Report',
            subtitle: '_\\(Triggered by Staff\\)_',
        }));
        return { success: true, message: 'SUCCESS' };
    }
    catch (error) {
        firebase_functions_1.logger.error('Error in triggerManualReport', error);
        return { success: false, message: 'Internal server error' };
    }
});
//# sourceMappingURL=manual_report.js.map