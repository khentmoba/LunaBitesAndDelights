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

async function deliverToAll(
  fnName: 'sendToAll' | 'sendPhotoToAll',
  fallbackNote: string,
  failLabel: string,
  options: Record<string, any>,
  send: (telegram: TelegramBot, id: string, opts: Record<string, any>, plainText: boolean) => Promise<unknown>,
) {
  const ids = telegramChatIds.value()
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

  if (ids.length === 0) {
    throw new Error('TELEGRAM_CHAT_ID is not configured — no recipients to notify');
  }

  const telegram = getBot();
  const sendOpts: Record<string, any> = {
    parse_mode: 'MarkdownV2',
    ...options,
  };

  const results = await Promise.allSettled(
    ids.map(async id => {
      try {
        return await send(telegram, id, sendOpts, false);
      } catch (err: any) {
        if (sendOpts.parse_mode && isMarkdownParseError(err)) {
          logger.warn(`${fnName}: MarkdownV2 parsing failed for chat ${id}; ${fallbackNote}`, {
            error: err?.message,
            chatId: id,
          });
          const { parse_mode: _, ...plainOpts } = sendOpts;
          return await send(telegram, id, plainOpts, true);
        }
        throw err;
      }
    })
  );

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error(
      `${fnName}: ${failures.length} of ${ids.length} messages failed`,
      failures.map((r, i) => ({
        chatId: ids[i],
        error: (r as PromiseRejectedResult).reason?.message || 'unknown',
      }))
    );
  }

  if (failures.length === ids.length) {
    throw new Error(`All ${ids.length} ${failLabel} failed`);
  }

  return results;
}

export async function sendToAll(message: string, options: any = {}) {
  return deliverToAll(
    'sendToAll',
    'falling back to plain text',
    'Telegram messages',
    options,
    (telegram, id, opts, plainText) =>
      telegram.sendMessage(id, plainText ? stripMarkdownV2(message) : message, opts)
  );
}

export async function sendPhotoToAll(
  photo: Buffer | string,
  caption: string,
  options: any = {}
) {
  const fileOpts = {
    filename: 'delivery_map.png',
    contentType: 'image/png',
  };
  return deliverToAll(
    'sendPhotoToAll',
    'falling back to plain text caption',
    'Telegram photo messages',
    options,
    (telegram, id, opts, plainText) =>
      telegram.sendPhoto(
        id,
        photo,
        { caption: plainText ? stripMarkdownV2(caption) : caption, ...opts },
        fileOpts
      )
  );
}

export function escapeMd(text: string | number | null | undefined): string {
  return String(text ?? '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Strips backslash escapes for falling back to plain-text delivery. */
export function stripMarkdownV2(text: string): string {
  return text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
}
