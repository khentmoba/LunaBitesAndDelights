"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleMapsApiKey = exports.paymongoSecret = exports.telegramChatIds = exports.telegramToken = void 0;
const params_1 = require("firebase-functions/params");
// Secrets (NOT params): values stay out of config/logs. Set via:
//   firebase functions:secrets:set TELEGRAM_TOKEN
//   firebase functions:secrets:set TELEGRAM_CHAT_ID
//   firebase functions:secrets:set PAYMONGO_SECRET_KEY
//   firebase functions:secrets:set GOOGLE_MAPS_API_KEY
exports.telegramToken = (0, params_1.defineSecret)('TELEGRAM_TOKEN');
exports.telegramChatIds = (0, params_1.defineSecret)('TELEGRAM_CHAT_ID');
exports.paymongoSecret = (0, params_1.defineSecret)('PAYMONGO_SECRET_KEY');
exports.googleMapsApiKey = (0, params_1.defineSecret)('GOOGLE_MAPS_API_KEY');
//# sourceMappingURL=secrets.js.map