import TelegramBot from 'node-telegram-bot-api';
import { telegramToken, telegramChatIds } from './index';
import { logger } from 'firebase-functions';

let bot: TelegramBot;

export function getBot() {
  if (!bot) {
    bot = new TelegramBot(telegramToken.value(), { polling: false });
  }
  return bot;
}

export function setBot(customBot: any) {
  bot = customBot;
}

export function isMarkdownParseError(err: any): boolean {
  const status = err?.response?.statusCode ?? err?.code;
  const desc = String(err?.response?.body?.description || err?.message || '').toLowerCase();
  if (desc.includes("can't parse entities") || desc.includes('must be escaped')) {
    return true;
  }
  return status === 400 && (
    desc.includes('parse') ||
    desc.includes('entity') ||
    desc.includes('entities') ||
    desc.includes('escape') ||
    desc === ''
  );
}

export async function sendToAll(message: string, options: any = {}) {
  const rawIds = telegramChatIds.value().split(',');
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

  const results = await Promise.allSettled(
    ids.map(async id => {
      try {
        return await telegram.sendMessage(id, message, sendOpts);
      } catch (err: any) {
        if (sendOpts.parse_mode && isMarkdownParseError(err)) {
          logger.warn(`sendToAll: MarkdownV2 parsing failed for chat ${id}; falling back to plain text`, {
            error: err?.message,
            chatId: id,
          });
          const { parse_mode: _, ...plainOpts } = sendOpts;
          return await telegram.sendMessage(id, stripMarkdownV2(message), plainOpts);
        }
        throw err;
      }
    })
  );

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error(
      `sendToAll: ${failures.length} of ${ids.length} messages failed`,
      failures.map((r, i) => ({
        chatId: ids[i],
        error: (r as PromiseRejectedResult).reason?.message || 'unknown'
      }))
    );
  }

  if (failures.length === ids.length) {
    throw new Error(`All ${ids.length} Telegram messages failed`);
  }

  return results;
}

export async function sendPhotoToAll(
  photo: Buffer | string,
  caption: string,
  options: any = {}
) {
  const rawIds = telegramChatIds.value().split(',');
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

  const results = await Promise.allSettled(
    ids.map(async id => {
      try {
        return await telegram.sendPhoto(id, photo, {
          caption,
          ...sendOpts,
        }, fileOpts);
      } catch (err: any) {
        if (sendOpts.parse_mode && isMarkdownParseError(err)) {
          logger.warn(`sendPhotoToAll: MarkdownV2 parsing failed for chat ${id}; falling back to plain text caption`, {
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
    })
  );

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error(
      `sendPhotoToAll: ${failures.length} of ${ids.length} messages failed`,
      failures.map((r, i) => ({
        chatId: ids[i],
        error: (r as PromiseRejectedResult).reason?.message || 'unknown',
      }))
    );
  }

  if (failures.length === ids.length) {
    throw new Error(`All ${ids.length} Telegram photo messages failed`);
  }

  return results;
}

export function escapeMd(text: string | number | null | undefined): string {
  return String(text ?? '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Strips backslash escapes for falling back to plain-text delivery. */
export function stripMarkdownV2(text: string): string {
  return text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
}
