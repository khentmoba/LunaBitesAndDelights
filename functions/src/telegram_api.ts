import { telegramToken, telegramChatIds } from './secrets';
import { logger } from 'firebase-functions';

export interface TelegramClient {
  sendMessage(chatId: string, text: string, opts?: Record<string, any>): Promise<unknown>;
  sendPhoto(
    chatId: string,
    photo: Buffer | string,
    opts?: Record<string, any>,
    fileOpts?: { filename?: string; contentType?: string },
  ): Promise<unknown>;
}

const TELEGRAM_TIMEOUT_MS = 10_000;

async function telegramRequest(token: string, method: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    ...init,
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || body?.ok === false) {
    const desc = body?.description || res.statusText || 'Telegram API error';
    const err: any = new Error(`ETELEGRAM: ${res.status} ${desc}`);
    err.response = { statusCode: res.status, body };
    throw err;
  }
  return body?.result;
}

function createNativeBot(token: string): TelegramClient {
  return {
    sendMessage(chatId, text, opts = {}) {
      return telegramRequest(token, 'sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...opts }),
      });
    },
    sendPhoto(chatId, photo, opts = {}, fileOpts = {}) {
      if (typeof photo === 'string') {
        return telegramRequest(token, 'sendPhoto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, photo, ...opts }),
        });
      }
      const form = new FormData();
      form.append('chat_id', chatId);
      for (const [k, v] of Object.entries(opts)) {
        if (v === undefined) continue;
        form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      const blob = new Blob([new Uint8Array(photo)], {
        type: fileOpts.contentType || 'application/octet-stream',
      });
      form.append('photo', blob, fileOpts.filename || 'photo.png');
      return telegramRequest(token, 'sendPhoto', { method: 'POST', body: form });
    },
  };
}

let bot: TelegramClient | null = null;

export function getBot(): TelegramClient {
  if (!bot) {
    bot = createNativeBot(telegramToken.value());
  }
  return bot;
}

export function setBot(customBot: TelegramClient | null) {
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

/**
 * Returns true for permanent Telegram 4xx failures (e.g. 400 bad request,
 * 401 unauthorized, 403 bot blocked, 404 chat not found) that will never
 * succeed on retry. Excludes 408 (timeout) and 429 (rate limit).
 */
export function isPermanentTelegramError(err: any): boolean {
  if (err?.permanent === true) return true;
  const status = err?.response?.statusCode ?? err?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function deliverToAll(
  fnName: 'sendToAll' | 'sendPhotoToAll',
  fallbackNote: string,
  failLabel: string,
  options: Record<string, any>,
  send: (telegram: TelegramClient, id: string, opts: Record<string, any>, plainText: boolean) => Promise<unknown>,
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

  const failures = results
    .map((r, i) => ({ r, chatId: ids[i] }))
    .filter((entry): entry is { r: PromiseRejectedResult; chatId: string } => entry.r.status === 'rejected');

  if (failures.length > 0) {
    logger.error(
      `${fnName}: ${failures.length} of ${ids.length} messages failed`,
      failures.map(({ r, chatId }) => ({
        chatId,
        error: r.reason?.message || 'unknown',
      }))
    );
  }

  if (failures.length === ids.length) {
    const err: any = new Error(`All ${ids.length} ${failLabel} failed`);
    err.permanent = failures.every(({ r }) => isPermanentTelegramError(r.reason));
    throw err;
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
