import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

/** Max allowed failed logins before lockout, and lockout duration. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Requires a signed-in staff/admin user (Firebase Auth custom claims set by
 * verifyStaff). Throws unauthenticated/permission-denied.
 * Covers checklist #6 (server-side auth) + #7 (lock record access).
 */
export function requireStaff(request: CallableRequest): string {
  const uid = request.auth?.uid;
  const role = (request.auth?.token as any)?.role;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
  if (role !== 'staff' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Staff access required');
  }
  return uid;
}

/** Trim + cap a free-text field. Throws invalid-argument when required & empty. */
export function cleanStr(v: unknown, max = 200, field = 'field'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length === 0) throw new HttpsError('invalid-argument', `Missing ${field}`);
  if (s.length > max) throw new HttpsError('invalid-argument', `${field} too long`);
  return s;
}

/** Optional free-text field: '' when absent, capped when present. */
export function optStr(v: unknown, max = 500): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (s.length > max) throw new HttpsError('invalid-argument', 'Field too long');
  return s;
}

/** Positive integer within a sane range (money, quantities). */
export function cleanInt(v: unknown, max: number, field = 'field'): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return n;
}

/** Alphanumeric Firestore auto-id format used for order documents. */
export const ALNUM_DOC_ID = /^[A-Za-z0-9]{1,64}$/;

/** Rejects path-traversal / weird doc IDs (#13: parameterized-query equivalent). */
export function validDocId(v: unknown, field = 'id'): string {
  const s = cleanStr(v, 128, field);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new HttpsError('invalid-argument', `Invalid ${field}`);
  return s;
}

function hashToken(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

/**
 * Firestore-backed login rate limiter (#11). Keyed by hashed identifier so
 * the attempts collection holds no PII. Throws resource-exhausted on lockout.
 * Call recordLoginFailure() on bad password, clearLoginAttempts() on success.
 */
export async function checkRateLimit(key: string): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('login_attempts').doc(hashToken(key));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data()!;
    const fails = d.fails || 0;
    const lockedUntil = d.lockedUntil?.toDate?.() as Date | undefined;
    if (fails >= MAX_ATTEMPTS && lockedUntil && lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpsError('resource-exhausted', `Too many attempts. Try again in ${mins}m`);
    }
    // Stale lockout expired — reset atomically.
    if (fails >= MAX_ATTEMPTS) tx.delete(ref);
  });
}

export async function recordLoginFailure(key: string): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('login_attempts').doc(hashToken(key));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const fails = (snap.data()?.fails || 0) + 1;
    tx.set(ref, {
      fails,
      updatedAt: FieldValue.serverTimestamp(),
      ...(fails >= MAX_ATTEMPTS
        ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
        : {}),
    }, { merge: true });
  });
}

export async function clearLoginAttempts(key: string): Promise<void> {
  await getFirestore().collection('login_attempts').doc(hashToken(key)).delete().catch(() => {});
}

/** Extracts a best-effort client IP string from an Express/Cloud Functions request. */
export function clientIpFromRequest(rawRequest?: { ip?: unknown }): string {
  return typeof rawRequest?.ip === 'string' && rawRequest.ip.trim().length > 0
    ? rawRequest.ip.trim()
    : '';
}

/**
 * Firestore-backed fixed-window rate limiter for public callables/webhooks and
 * global failure budgets. Throws resource-exhausted when maxRequests is exceeded.
 */
export async function enforceFixedWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  message = 'Too many requests. Please try again shortly.',
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('rate_limits').doc(hashToken(key));
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data()! : null;
    const windowStart = typeof d?.windowStart === 'number' ? d.windowStart : 0;
    const count = typeof d?.count === 'number' ? d.count : 0;
    if (d && now - windowStart < windowMs) {
      if (count >= maxRequests) {
        throw new HttpsError('resource-exhausted', message);
      }
      tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    tx.set(ref, {
      count: 1,
      windowStart: now,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/** Checks a fixed-window failure counter without incrementing it. */
export async function checkWindowBudget(
  key: string,
  maxFailures: number,
  windowMs: number,
  message = 'Too many attempts. Please try again later.',
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('rate_limits').doc(hashToken(key));
  const snap = await ref.get();
  if (!snap.exists) return;
  const d = snap.data()!;
  const windowStart = typeof d.windowStart === 'number' ? d.windowStart : 0;
  const count = typeof d.count === 'number' ? d.count : 0;
  if (Date.now() - windowStart < windowMs && count >= maxFailures) {
    throw new HttpsError('resource-exhausted', message);
  }
}

/** Records one failure into a fixed-window budget. */
export async function recordWindowFailure(key: string, windowMs: number): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('rate_limits').doc(hashToken(key));
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data()! : null;
    const windowStart = typeof d?.windowStart === 'number' ? d.windowStart : 0;
    const count = typeof d?.count === 'number' ? d.count : 0;
    if (d && now - windowStart < windowMs) {
      tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    tx.set(ref, {
      count: 1,
      windowStart: now,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

// ─── Password hashing: scrypt with per-user salt (#10) ───

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** Verifies scrypt hashes; also accepts legacy unsalted sha256 for migration. */
export function verifyPassword(password: string, stored: string): 'ok' | 'ok-legacy' | 'bad' {
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return 'bad';
    const calcBuf = crypto.scryptSync(password, salt, 32);
    const hashBuf = Buffer.from(hash, 'hex');
    if (calcBuf.length !== hashBuf.length) return 'bad';
    return crypto.timingSafeEqual(calcBuf, hashBuf) ? 'ok' : 'bad';
  }
  // Legacy sha256 — caller should re-hash with scrypt on success.
  const legacyBuf = Buffer.from(crypto.createHash('sha256').update(password).digest('hex'), 'utf8');
  const storedBuf = Buffer.from(stored, 'utf8');
  if (legacyBuf.length !== storedBuf.length) return 'bad';
  return crypto.timingSafeEqual(legacyBuf, storedBuf) ? 'ok-legacy' : 'bad';
}

export async function verifyPasswordAsync(password: string, stored: string): Promise<'ok' | 'ok-legacy' | 'bad'> {
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return 'bad';
    const calcBuf = (await scryptAsync(password, salt, 32)) as Buffer;
    const hashBuf = Buffer.from(hash, 'hex');
    if (calcBuf.length !== hashBuf.length) return 'bad';
    return crypto.timingSafeEqual(calcBuf, hashBuf) ? 'ok' : 'bad';
  }
  const legacyBuf = Buffer.from(crypto.createHash('sha256').update(password).digest('hex'), 'utf8');
  const storedBuf = Buffer.from(stored, 'utf8');
  if (legacyBuf.length !== storedBuf.length) return 'bad';
  return crypto.timingSafeEqual(legacyBuf, storedBuf) ? 'ok-legacy' : 'bad';
}
