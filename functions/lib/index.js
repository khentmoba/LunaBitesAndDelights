"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymongoWebhook = exports.createCheckoutSession = exports.getLifetimeSalesReport = exports.getSalesAnalytics = exports.onOrderWritten = exports.updateOrderStatus = exports.getActiveOrders = exports.sendOrderNotification = exports.updateStaffPin = exports.verifyStaff = exports.triggerManualReport = exports.dailySalesReport = exports.googleMapsApiKey = exports.paymongoSecret = exports.telegramChatIds = exports.telegramToken = void 0;
const app_1 = require("firebase-admin/app");
const params_1 = require("firebase-functions/params");
(0, app_1.initializeApp)();
// Secrets (NOT params): values stay out of config/logs. Set via:
//   firebase functions:secrets:set TELEGRAM_TOKEN
//   firebase functions:secrets:set TELEGRAM_CHAT_ID
//   firebase functions:secrets:set PAYMONGO_SECRET_KEY
//   firebase functions:secrets:set GOOGLE_MAPS_API_KEY
exports.telegramToken = (0, params_1.defineSecret)('TELEGRAM_TOKEN');
exports.telegramChatIds = (0, params_1.defineSecret)('TELEGRAM_CHAT_ID');
exports.paymongoSecret = (0, params_1.defineSecret)('PAYMONGO_SECRET_KEY');
exports.googleMapsApiKey = (0, params_1.defineSecret)('GOOGLE_MAPS_API_KEY');
var daily_report_1 = require("./reporting/daily_report");
Object.defineProperty(exports, "dailySalesReport", { enumerable: true, get: function () { return daily_report_1.dailySalesReport; } });
var manual_report_1 = require("./reporting/manual_report");
Object.defineProperty(exports, "triggerManualReport", { enumerable: true, get: function () { return manual_report_1.triggerManualReport; } });
var verify_staff_1 = require("./auth/verify_staff");
Object.defineProperty(exports, "verifyStaff", { enumerable: true, get: function () { return verify_staff_1.verifyStaff; } });
Object.defineProperty(exports, "updateStaffPin", { enumerable: true, get: function () { return verify_staff_1.updateStaffPin; } });
var send_notification_1 = require("./orders/send_notification");
Object.defineProperty(exports, "sendOrderNotification", { enumerable: true, get: function () { return send_notification_1.sendOrderNotification; } });
var kds_1 = require("./orders/kds");
Object.defineProperty(exports, "getActiveOrders", { enumerable: true, get: function () { return kds_1.getActiveOrders; } });
Object.defineProperty(exports, "updateOrderStatus", { enumerable: true, get: function () { return kds_1.updateOrderStatus; } });
var derived_1 = require("./orders/derived");
Object.defineProperty(exports, "onOrderWritten", { enumerable: true, get: function () { return derived_1.onOrderWritten; } });
var analytics_1 = require("./reporting/analytics");
Object.defineProperty(exports, "getSalesAnalytics", { enumerable: true, get: function () { return analytics_1.getSalesAnalytics; } });
var lifetime_report_1 = require("./reporting/lifetime_report");
Object.defineProperty(exports, "getLifetimeSalesReport", { enumerable: true, get: function () { return lifetime_report_1.getLifetimeSalesReport; } });
var create_checkout_1 = require("./payments/create_checkout");
Object.defineProperty(exports, "createCheckoutSession", { enumerable: true, get: function () { return create_checkout_1.createCheckoutSession; } });
var webhook_1 = require("./payments/webhook");
Object.defineProperty(exports, "paymongoWebhook", { enumerable: true, get: function () { return webhook_1.paymongoWebhook; } });
//# sourceMappingURL=index.js.map