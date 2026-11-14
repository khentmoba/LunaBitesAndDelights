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
exports.updateStaffPin = exports.verifyStaff = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const firebase_functions_1 = require("firebase-functions");
const crypto = __importStar(require("crypto"));
const security_1 = require("../util/security");
const GENERIC_FAIL = 'Invalid username or password';
const GENERIC_PIN_FAIL = 'Invalid PIN. Please try again.';
exports.verifyStaff = (0, https_1.onCall)(async (request) => {
    const pin = typeof request.data?.pin === 'string' ? request.data.pin.trim() : null;
    const usernameRaw = typeof request.data?.username === 'string' ? request.data.username.trim().toLowerCase() : null;
    const password = typeof request.data?.password === 'string' ? request.data.password : null;
    const db = (0, firestore_1.getFirestore)();
    // First-run seed: random per-deploy passwords (logged ONCE — rotate after).
    // Never seed well-known defaults; they end up in git/history forever.
    if ((await db.collection('staff_accounts').limit(1).get()).empty) {
        const mk = () => crypto.randomBytes(9).toString('base64url');
        const mkPin = () => String(crypto.randomInt(100000, 1000000));
        const seeds = [
            { username: 'admin', role: 'admin', pin: mkPin() },
            { username: 'staff1', role: 'staff', pin: mkPin() },
        ];
        const batch = db.batch();
        for (const s of seeds) {
            const pw = mk();
            batch.set(db.collection('staff_accounts').doc(s.username), {
                username: s.username,
                role: s.role,
                passwordHash: (0, security_1.hashPassword)(pw),
                pinHash: (0, security_1.hashPassword)(s.pin),
                createdAt: new Date(),
            });
            firebase_functions_1.logger.warn(`SEEDED staff account ${s.username} password: ${pw}, pin: ${s.pin} — CHANGE AFTER FIRST LOGIN`);
        }
        await batch.commit();
    }
    // ── Quick PIN Login Flow ──
    if (pin) {
        if (!/^[0-9]{4,8}$/.test(pin)) {
            throw new https_1.HttpsError('invalid-argument', GENERIC_PIN_FAIL);
        }
        await (0, security_1.checkRateLimit)('staff:pin_login');
        const failPin = async () => {
            await (0, security_1.recordLoginFailure)('staff:pin_login');
            return { success: false, message: GENERIC_PIN_FAIL };
        };
        const staffAccounts = await db.collection('staff_accounts').get();
        let matchedUser = null;
        if (!staffAccounts.empty) {
            for (const doc of staffAccounts.docs) {
                const d = doc.data();
                if (d.pinHash && (0, security_1.verifyPassword)(pin, d.pinHash) !== 'bad') {
                    matchedUser = { id: doc.id, ...d };
                    break;
                }
            }
        }
        if (!matchedUser) {
            firebase_functions_1.logger.info('Staff PIN login failed: bad PIN');
            return failPin();
        }
        await (0, security_1.clearLoginAttempts)('staff:pin_login');
        const role = matchedUser.role === 'admin' ? 'admin' : 'staff';
        const customToken = await (0, auth_1.getAuth)().createCustomToken(`staff_${matchedUser.username || matchedUser.id}`, { role });
        firebase_functions_1.logger.info(`Staff PIN login successful for ${matchedUser.username || matchedUser.id} as ${role}`);
        return { success: true, username: matchedUser.username || matchedUser.id, role, customToken };
    }
    // ── Username + Password Flow ──
    if (!usernameRaw || !password) {
        throw new https_1.HttpsError('invalid-argument', GENERIC_FAIL);
    }
    const username = (0, security_1.cleanStr)(usernameRaw, 64, 'username');
    if (!/^[a-z0-9._-]{2,64}$/.test(username))
        throw new https_1.HttpsError('invalid-argument', GENERIC_FAIL);
    // #11 rate limit login (lockout after 5 failures)
    await (0, security_1.checkRateLimit)(`staff:${username}`);
    const fail = async () => {
        await (0, security_1.recordLoginFailure)(`staff:${username}`);
        return { success: false, message: GENERIC_FAIL };
    };
    const staffRef = db.collection('staff_accounts').doc(username);
    const doc = await staffRef.get();
    if (!doc.exists) {
        firebase_functions_1.logger.info('Staff login failed: unknown user');
        return fail();
    }
    const data = doc.data();
    if (!data.passwordHash) {
        firebase_functions_1.logger.error('Staff account missing passwordHash');
        throw new https_1.HttpsError('internal', 'Server misconfigured');
    }
    const result = (0, security_1.verifyPassword)(password, data.passwordHash);
    if (result === 'bad') {
        firebase_functions_1.logger.info('Staff login failed: bad password');
        return fail();
    }
    // Auto-upgrade legacy sha256 hashes to scrypt (#10)
    if (result === 'ok-legacy') {
        await staffRef.update({ passwordHash: (0, security_1.hashPassword)(password) });
        firebase_functions_1.logger.info('Upgraded legacy staff password hash to scrypt');
    }
    await (0, security_1.clearLoginAttempts)(`staff:${username}`);
    await staffRef.update({ lastLoginAt: firestore_1.FieldValue.serverTimestamp() }).catch(() => { });
    // #6 + #9: issue a real Firebase session (custom token with staff claim)
    // instead of a bare {success:true} the client could forge.
    const role = data.role === 'admin' ? 'admin' : 'staff';
    const customToken = await (0, auth_1.getAuth)().createCustomToken(`staff_${username}`, { role });
    firebase_functions_1.logger.info('Staff login successful');
    return { success: true, username: data.username || username, role, customToken };
});
exports.updateStaffPin = (0, https_1.onCall)(async (request) => {
    const uid = (0, security_1.requireStaff)(request);
    const newPin = (0, security_1.cleanStr)(request.data?.newPin, 16, 'newPin');
    if (!/^[0-9]{4,8}$/.test(newPin)) {
        throw new https_1.HttpsError('invalid-argument', 'PIN must be between 4 and 8 digits');
    }
    const username = uid.replace(/^staff_/, '');
    const db = (0, firestore_1.getFirestore)();
    const staffRef = db.collection('staff_accounts').doc(username);
    const doc = await staffRef.get();
    if (!doc.exists) {
        throw new https_1.HttpsError('not-found', 'Staff account not found');
    }
    await staffRef.update({
        pinHash: (0, security_1.hashPassword)(newPin),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    firebase_functions_1.logger.info(`Updated PIN for staff account ${username}`);
    return { success: true };
});
//# sourceMappingURL=verify_staff.js.map