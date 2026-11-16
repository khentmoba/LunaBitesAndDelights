import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

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
  const ref = getFirestore().collection('login_attempts').doc(hashToken(key));
  const snap = await ref.get();
  if (!snap.exists) return;
  const d = snap.data()!;
  const fails = d.fails || 0;
  const lockedUntil = d.lockedUntil?.toDate?.() as Date | undefined;
  if (fails >= MAX_ATTEMPTS && lockedUntil && lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
    throw new HttpsError('resource-exhausted', `Too many attempts. Try again in ${mins}m`);
  }
  // Stale lockout expired — reset.
  if (fails >= MAX_ATTEMPTS) await ref.delete();
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

// ─── Password hashing: scrypt with per-user salt (#10) ───

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
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
