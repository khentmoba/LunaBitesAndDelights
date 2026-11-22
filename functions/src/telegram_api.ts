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
    const token = telegramToken.value().trim();
    if (!token) {
      throw new Error('TELEGRAM_TOKEN is not configured');
    }
    bot = createNativeBot(token);
  }
  return bot;
}

export function setBot(customBot: TelegramClient | null) {
  bot = customBot;
}

/** Returns true when both TELEGRAM_TOKEN and TELEGRAM_CHAT_ID are configured and non-empty. */
export function hasTelegramConfig(): boolean {
  try {
    return telegramToken.value().trim().length > 0 && telegramChatIds.value().trim().length > 0;
  } catch {
    return false;
  }
}

const DEFAULT_MAX_SEND_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_MAX_RETRY_AFTER_MS = 5_000;

export interface TelegramRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxRetryAfterMs: number;
  sleep: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let retryConfig: TelegramRetryConfig = {
  maxAttempts: DEFAULT_MAX_SEND_ATTEMPTS,
  baseDelayMs: DEFAULT_RETRY_BASE_MS,
  maxRetryAfterMs: DEFAULT_MAX_RETRY_AFTER_MS,
  sleep: defaultSleep,
};

export function setTelegramRetryConfig(overrides: Partial<TelegramRetryConfig> | null) {
  retryConfig = overrides
    ? { ...retryConfig, ...overrides }
    : {
        maxAttempts: DEFAULT_MAX_SEND_ATTEMPTS,
        baseDelayMs: DEFAULT_RETRY_BASE_MS,
        maxRetryAfterMs: DEFAULT_MAX_RETRY_AFTER_MS,
        sleep: defaultSleep,
      };
}

/** Extracts Telegram's `migrate_to_chat_id` when a group has been upgraded to a supergroup. */
export function getMigratedChatId(err: any): string | null {
  const raw = err?.response?.body?.parameters?.migrate_to_chat_id;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw !== 0) {
    return String(raw);
  }
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) && raw.trim() !== '0') {
    return raw.trim();
  }
  return null;
}

/** Extracts Telegram's `retry_after` cooldown in milliseconds from a 429 response. */
export function getTelegramRetryAfterMs(err: any): number | null {
  const raw = err?.response?.body?.parameters?.retry_after;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.ceil(raw * 1000);
  }
  return null;
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
 * succeed on retry. Excludes 408 (timeout), 429 (rate limit), and group
 * migrations (`migrate_to_chat_id`).
 */
export function isPermanentTelegramError(err: any): boolean {
  if (err?.permanent === true) return true;
  if (err?.permanent === false) return false;
  if (getMigratedChatId(err)) return false;
  const status = err?.response?.statusCode ?? err?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type TelegramDeliveryResult = PromiseSettledResult<unknown>[] & {
  deliveredChatIds: string[];
};

async function sendToChatWithRetry(
  telegram: TelegramClient,
  originalChatId: string,
  initialOpts: Record<string, any>,
  fnName: 'sendToAll' | 'sendPhotoToAll',
  fallbackNote: string,
  skipSet: Set<string>,
  send: (telegram: TelegramClient, id: string, opts: Record<string, any>, plainText: boolean) => Promise<unknown>,
): Promise<{ result: unknown; deliveredChatIds: string[] }> {
  let targetChatId = originalChatId;
  let activeOpts = initialOpts;
  let usePlainText = false;
  let migrationUsed = false;
  let transientAttempts = 0;

  for (;;) {
    try {
      const result = await send(telegram, targetChatId, activeOpts, usePlainText);
      const deliveredChatIds = targetChatId !== originalChatId
        ? [originalChatId, targetChatId]
        : [originalChatId];
      return { result, deliveredChatIds };
    } catch (err: any) {
      if (!usePlainText && activeOpts.parse_mode && isMarkdownParseError(err)) {
        logger.warn(`${fnName}: MarkdownV2 parsing failed for chat ${targetChatId}; ${fallbackNote}`, {
          error: err?.message,
          chatId: targetChatId,
        });
        usePlainText = true;
        const { parse_mode: _, ...plainOpts } = activeOpts;
        activeOpts = plainOpts;
        continue;
      }

      if (!migrationUsed) {
        const migratedId = getMigratedChatId(err);
        if (migratedId && migratedId !== targetChatId) {
          logger.warn(
            `${fnName}: chat ${targetChatId} migrated to supergroup ${migratedId}; retrying with new chat ID (update TELEGRAM_CHAT_ID secret)`,
            { oldChatId: targetChatId, newChatId: migratedId },
          );
          if (skipSet.has(migratedId)) {
            return { result: null, deliveredChatIds: [originalChatId, migratedId] };
          }
          migrationUsed = true;
          targetChatId = migratedId;
          continue;
        }
      }

      if (isPermanentTelegramError(err)) {
        throw err;
      }

      transientAttempts++;
      if (transientAttempts >= retryConfig.maxAttempts) {
        throw err;
      }

      const retryAfterMs = getTelegramRetryAfterMs(err);
      if (retryAfterMs !== null && retryAfterMs > retryConfig.maxRetryAfterMs) {
        logger.warn(
          `${fnName}: Telegram rate-limited chat ${targetChatId} for ${retryAfterMs}ms (> ${retryConfig.maxRetryAfterMs}ms cap); deferring to outer retry`,
          { chatId: targetChatId, retryAfterMs },
        );
        throw err;
      }

      const delayMs = retryAfterMs ?? retryConfig.baseDelayMs * Math.pow(2, transientAttempts - 1);
      logger.warn(
        `${fnName}: transient error for chat ${targetChatId} (attempt ${transientAttempts}/${retryConfig.maxAttempts}); retrying in ${delayMs}ms`,
        { chatId: targetChatId, error: err?.message || 'unknown', delayMs },
      );
      await retryConfig.sleep(delayMs);
    }
  }
}

async function deliverToAll(
  fnName: 'sendToAll' | 'sendPhotoToAll',
  fallbackNote: string,
  failLabel: string,
  options: Record<string, any>,
  send: (telegram: TelegramClient, id: string, opts: Record<string, any>, plainText: boolean) => Promise<unknown>,
): Promise<TelegramDeliveryResult> {
  const allIds = Array.from(
    new Set(
      telegramChatIds.value()
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0),
    ),
  );

  if (allIds.length === 0) {
    throw new Error('TELEGRAM_CHAT_ID is not configured — no recipients to notify');
  }

  const { skipChatIds, ...telegramOptions } = options || {};
  const skipSet = new Set<string>(
    Array.isArray(skipChatIds)
      ? skipChatIds.map(String)
      : skipChatIds instanceof Set
        ? Array.from(skipChatIds, String)
        : [],
  );
  const ids = allIds.filter(id => !skipSet.has(id));
  if (ids.length === 0) {
    return Object.assign([] as PromiseSettledResult<unknown>[], { deliveredChatIds: [] as string[] });
  }

  const telegram = getBot();
  const sendOpts: Record<string, any> = {
    parse_mode: 'MarkdownV2',
    ...telegramOptions,
  };

  const rawResults = await Promise.allSettled(
    ids.map(id => sendToChatWithRetry(telegram, id, sendOpts, fnName, fallbackNote, skipSet, send)),
  );

  const deliveredSet = new Set<string>();
  const results: PromiseSettledResult<unknown>[] = rawResults.map((r) => {
    if (r.status === 'fulfilled') {
      for (const id of r.value.deliveredChatIds) deliveredSet.add(id);
      return { status: 'fulfilled', value: r.value.result };
    }
    return r;
  });
  const deliveredChatIds = Array.from(deliveredSet);

  const failures = rawResults
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

  const retryableFailures = failures.filter(({ r }) => !isPermanentTelegramError(r.reason));
  if (retryableFailures.length > 0) {
    const err: any = new Error(
      failures.length === ids.length
        ? `All ${ids.length} ${failLabel} failed`
        : `${retryableFailures.length} of ${ids.length} ${failLabel} failed transiently`,
    );
    err.permanent = false;
    err.deliveredChatIds = deliveredChatIds;
    err.failedChatIds = failures.map(f => f.chatId);
    throw err;
  }

  if (failures.length === ids.length) {
    const err: any = new Error(`All ${ids.length} ${failLabel} failed`);
    err.permanent = true;
    err.deliveredChatIds = deliveredChatIds;
    err.failedChatIds = failures.map(f => f.chatId);
    throw err;
  }

  return Object.assign(results, { deliveredChatIds });
}

const TELEGRAM_MAX_TEXT = 3800;

/** Splits a Telegram message into <= maxLen chunks on newline boundaries without breaking escape sequences. */
export function splitTelegramMessage(text: string, maxLen = TELEGRAM_MAX_TEXT): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = maxLen;
    // Avoid splitting in the middle of a MarkdownV2 backslash escape sequence.
    let trailingBackslashes = 0;
    for (let i = cut - 1; i >= 0 && rest[i] === '\\'; i--) trailingBackslashes++;
    if (trailingBackslashes % 2 === 1 && cut > 1) cut--;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export async function sendToAll(message: string, options: any = {}): Promise<TelegramDeliveryResult> {
  const chunks = splitTelegramMessage(message);
  let lastResult: TelegramDeliveryResult = Object.assign([], { deliveredChatIds: [] as string[] });
  let deliveredAcrossAllChunks: Set<string> | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const chunk = chunks[i];
    const chunkOpts = isLast ? options : { ...options, reply_markup: undefined };
    try {
      lastResult = await deliverToAll(
        'sendToAll',
        'falling back to plain text',
        'Telegram messages',
        chunkOpts,
        (telegram, id, opts, plainText) =>
          telegram.sendMessage(id, plainText ? stripMarkdownV2(chunk) : chunk, opts)
      );
    } catch (err: any) {
      if (!isLast) {
        err.deliveredChatIds = [];
      } else if (deliveredAcrossAllChunks && Array.isArray(err.deliveredChatIds)) {
        err.deliveredChatIds = err.deliveredChatIds.filter((id: string) => deliveredAcrossAllChunks!.has(id));
      }
      throw err;
    }
    if (deliveredAcrossAllChunks === null) {
      deliveredAcrossAllChunks = new Set<string>(lastResult.deliveredChatIds);
    } else {
      const chunkDelivered = new Set<string>(lastResult.deliveredChatIds);
      const prev: Set<string> = deliveredAcrossAllChunks;
      deliveredAcrossAllChunks = new Set<string>(
        Array.from(prev).filter((id) => chunkDelivered.has(id)),
      );
    }
  }
  return Object.assign(lastResult, {
    deliveredChatIds: deliveredAcrossAllChunks ? Array.from(deliveredAcrossAllChunks) : [],
  });
}

export async function sendPhotoToAll(
  photo: Buffer | string,
  caption: string,
  options: any = {}
): Promise<TelegramDeliveryResult> {
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
