import * as crypto from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Derives a deterministic alphanumeric Firestore order doc ID from an idempotency key. */
export function idempotentOrderDocId(key: string): string {
  return `ord${crypto.createHash('sha256').update(key).digest('hex').slice(0, 28)}`;
}

/** Verifies a submitted idempotency key against the doc ID used for the stored order. */
export function matchesIdempotentOrderDocId(orderDocId: string, rawKey: unknown): boolean {
  if (typeof rawKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(rawKey)) return false;
  return idempotentOrderDocId(rawKey) === orderDocId;
}

/** Validates an optional idempotencyKey without silently ignoring malformed non-string inputs. */
export function parseIdempotencyKey(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'Invalid idempotencyKey');
  }
  const key = raw.trim();
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new HttpsError('invalid-argument', 'Invalid idempotencyKey');
  }
  return key;
}
