"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALNUM_DOC_ID = void 0;
exports.requireStaff = requireStaff;
exports.cleanStr = cleanStr;
exports.optStr = optStr;
exports.cleanInt = cleanInt;
exports.validDocId = validDocId;
exports.checkRateLimit = checkRateLimit;
exports.recordLoginFailure = recordLoginFailure;
exports.clearLoginAttempts = clearLoginAttempts;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const crypto = __importStar(require("crypto"));
/** Max allowed failed logins before lockout, and lockout duration. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
/**
 * Requires a signed-in staff/admin user (Firebase Auth custom claims set by
 * verifyStaff). Throws unauthenticated/permission-denied.
 * Covers checklist #6 (server-side auth) + #7 (lock record access).
 */
function requireStaff(request) {
    const uid = request.auth?.uid;
    const role = request.auth?.token?.role;
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required');
    if (role !== 'staff' && role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Staff access required');
    }
    return uid;
}
/** Trim + cap a free-text field. Throws invalid-argument when required & empty. */
function cleanStr(v, max = 200, field = 'field') {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length === 0)
        throw new https_1.HttpsError('invalid-argument', `Missing ${field}`);
    if (s.length > max)
        throw new https_1.HttpsError('invalid-argument', `${field} too long`);
    return s;
}
/** Optional free-text field: '' when absent, capped when present. */
function optStr(v, max = 500) {
    if (v == null)
        return '';
    const s = String(v).trim();
    if (s.length > max)
        throw new https_1.HttpsError('invalid-argument', 'Field too long');
    return s;
}
/** Positive integer within a sane range (money, quantities). */
function cleanInt(v, max, field = 'field') {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) {
        throw new https_1.HttpsError('invalid-argument', `Invalid ${field}`);
    }
    return n;
}
/** Alphanumeric Firestore auto-id format used for order documents. */
exports.ALNUM_DOC_ID = /^[A-Za-z0-9]{1,64}$/;
/** Rejects path-traversal / weird doc IDs (#13: parameterized-query equivalent). */
function validDocId(v, field = 'id') {
    const s = cleanStr(v, 128, field);
    if (!/^[A-Za-z0-9_-]+$/.test(s))
        throw new https_1.HttpsError('invalid-argument', `Invalid ${field}`);
    return s;
}
function hashToken(s) {
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}
/**
 * Firestore-backed login rate limiter (#11). Keyed by hashed identifier so
 * the attempts collection holds no PII. Throws resource-exhausted on lockout.
 * Call recordLoginFailure() on bad password, clearLoginAttempts() on success.
 */
async function checkRateLimit(key) {
    const ref = (0, firestore_1.getFirestore)().collection('login_attempts').doc(hashToken(key));
    const snap = await ref.get();
    if (!snap.exists)
        return;
    const d = snap.data();
    const fails = d.fails || 0;
    const lockedUntil = d.lockedUntil?.toDate?.();
    if (fails >= MAX_ATTEMPTS && lockedUntil && lockedUntil.getTime() > Date.now()) {
        const mins = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
        throw new https_1.HttpsError('resource-exhausted', `Too many attempts. Try again in ${mins}m`);
    }
    // Stale lockout expired — reset.
    if (fails >= MAX_ATTEMPTS)
        await ref.delete();
}
async function recordLoginFailure(key) {
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection('login_attempts').doc(hashToken(key));
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const fails = (snap.data()?.fails || 0) + 1;
        tx.set(ref, {
            fails,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ...(fails >= MAX_ATTEMPTS
                ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
                : {}),
        }, { merge: true });
    });
}
async function clearLoginAttempts(key) {
    await (0, firestore_1.getFirestore)().collection('login_attempts').doc(hashToken(key)).delete().catch(() => { });
}
// ─── Password hashing: scrypt with per-user salt (#10) ───
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return `scrypt$${salt}$${hash}`;
}
/** Verifies scrypt hashes; also accepts legacy unsalted sha256 for migration. */
function verifyPassword(password, stored) {
    if (stored.startsWith('scrypt$')) {
        const [, salt, hash] = stored.split('$');
        if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash))
            return 'bad';
        const calcBuf = crypto.scryptSync(password, salt, 32);
        const hashBuf = Buffer.from(hash, 'hex');
        if (calcBuf.length !== hashBuf.length)
            return 'bad';
        return crypto.timingSafeEqual(calcBuf, hashBuf) ? 'ok' : 'bad';
    }
    // Legacy sha256 — caller should re-hash with scrypt on success.
    const legacyBuf = Buffer.from(crypto.createHash('sha256').update(password).digest('hex'), 'utf8');
    const storedBuf = Buffer.from(stored, 'utf8');
    if (legacyBuf.length !== storedBuf.length)
        return 'bad';
    return crypto.timingSafeEqual(legacyBuf, storedBuf) ? 'ok-legacy' : 'bad';
}
//# sourceMappingURL=security.js.map