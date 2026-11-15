"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBot = getBot;
exports.setBot = setBot;
exports.isMarkdownParseError = isMarkdownParseError;
exports.sendToAll = sendToAll;
exports.sendPhotoToAll = sendPhotoToAll;
exports.escapeMd = escapeMd;
exports.stripMarkdownV2 = stripMarkdownV2;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const index_1 = require("./index");
const firebase_functions_1 = require("firebase-functions");
let bot;
function getBot() {
    if (!bot) {
        bot = new node_telegram_bot_api_1.default(index_1.telegramToken.value(), { polling: false });
    }
    return bot;
}
function setBot(customBot) {
    bot = customBot;
}
function isMarkdownParseError(err) {
    const status = err?.response?.statusCode ?? err?.code;
    const desc = String(err?.response?.body?.description || err?.message || '').toLowerCase();
    if (desc.includes("can't parse entities") || desc.includes('must be escaped')) {
        return true;
    }
    return status === 400 && (desc.includes('parse') ||
        desc.includes('entity') ||
        desc.includes('entities') ||
        desc.includes('escape') ||
        desc === '');
}
async function sendToAll(message, options = {}) {
    const rawIds = index_1.telegramChatIds.value().split(',');
    const ids = rawIds
        .map(id => id.trim())
        .filter(id => id.length > 0);
    if (ids.length === 0) {
        throw new Error('TELEGRAM_CHAT_ID is not configured — no recipients to notify');
    }
    const telegram = getBot();
    const sendOpts = {
        parse_mode: 'MarkdownV2',
        ...options,
    };
    const results = await Promise.allSettled(ids.map(async (id) => {
        try {
            return await telegram.sendMessage(id, message, sendOpts);
        }
        catch (err) {
            if (sendOpts.parse_mode && isMarkdownParseError(err)) {
                firebase_functions_1.logger.warn(`sendToAll: MarkdownV2 parsing failed for chat ${id}; falling back to plain text`, {
                    error: err?.message,
                    chatId: id,
                });
                const { parse_mode: _, ...plainOpts } = sendOpts;
                return await telegram.sendMessage(id, stripMarkdownV2(message), plainOpts);
            }
            throw err;
        }
    }));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        firebase_functions_1.logger.error(`sendToAll: ${failures.length} of ${ids.length} messages failed`, failures.map((r, i) => ({
            chatId: ids[i],
            error: r.reason?.message || 'unknown'
        })));
    }
    if (failures.length === ids.length) {
        throw new Error(`All ${ids.length} Telegram messages failed`);
    }
    return results;
}
async function sendPhotoToAll(photo, caption, options = {}) {
    const rawIds = index_1.telegramChatIds.value().split(',');
    const ids = rawIds
        .map(id => id.trim())
        .filter(id => id.length > 0);
    if (ids.length === 0) {
        throw new Error('TELEGRAM_CHAT_ID is not configured — no recipients to notify');
    }
    const telegram = getBot();
    const sendOpts = {
        parse_mode: 'MarkdownV2',
        ...options,
    };
    const fileOpts = {
        filename: 'delivery_map.png',
        contentType: 'image/png',
    };
    const results = await Promise.allSettled(ids.map(async (id) => {
        try {
            return await telegram.sendPhoto(id, photo, {
                caption,
                ...sendOpts,
            }, fileOpts);
        }
        catch (err) {
            if (sendOpts.parse_mode && isMarkdownParseError(err)) {
                firebase_functions_1.logger.warn(`sendPhotoToAll: MarkdownV2 parsing failed for chat ${id}; falling back to plain text caption`, {
                    error: err?.message,
                    chatId: id,
                });
                const { parse_mode: _, ...plainOpts } = sendOpts;
                return await telegram.sendPhoto(id, photo, {
                    caption: stripMarkdownV2(caption),
                    ...plainOpts,
                }, fileOpts);
            }
            throw err;
        }
    }));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        firebase_functions_1.logger.error(`sendPhotoToAll: ${failures.length} of ${ids.length} messages failed`, failures.map((r, i) => ({
            chatId: ids[i],
            error: r.reason?.message || 'unknown',
        })));
    }
    if (failures.length === ids.length) {
        throw new Error(`All ${ids.length} Telegram photo messages failed`);
    }
    return results;
}
function escapeMd(text) {
    return String(text ?? '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
/** Strips backslash escapes for falling back to plain-text delivery. */
function stripMarkdownV2(text) {
    return text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
}
//# sourceMappingURL=telegram_api.js.map