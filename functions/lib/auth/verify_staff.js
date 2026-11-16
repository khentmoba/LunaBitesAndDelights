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
const PIN_RE = /^[0-9]{4,8}$/;
async function ensureStaffSeeded(db) {
    if (!(await db.collection('staff_accounts').limit(1).get()).empty)
        return;
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
async function createStaffToken(uidName, rawRole) {
    const role = rawRole === 'admin' ? 'admin' : 'staff';
    const customToken = await (0, auth_1.getAuth)().createCustomToken(`staff_${uidName}`, { role });
    return { role, customToken };
}
async function verifyPinLogin(db, request, pin) {
    if (!PIN_RE.test(pin)) {
        throw new https_1.HttpsError('invalid-argument', GENERIC_PIN_FAIL);
    }
    const clientIp = typeof request.rawRequest?.ip === 'string' && request.rawRequest.ip
        ? request.rawRequest.ip
        : '';
    const pinRateKey = clientIp ? `staff:pin_login:${clientIp}` : 'staff:pin_login';
    await (0, security_1.checkRateLimit)(pinRateKey);
    const staffAccounts = await db.collection('staff_accounts').get();
    let matchedUser = null;
    let matchedPinResult = 'ok';
    for (const doc of staffAccounts.docs) {
        const d = doc.data();
        if (!d.pinHash)
            continue;
        const pinRes = (0, security_1.verifyPassword)(pin, d.pinHash);
        if (pinRes !== 'bad') {
            matchedUser = { id: doc.id, docRef: doc.ref, ...d };
            matchedPinResult = pinRes;
            break;
        }
    }
    if (!matchedUser) {
        firebase_functions_1.logger.info('Staff PIN login failed: bad PIN');
        await (0, security_1.recordLoginFailure)(pinRateKey);
        return { success: false, message: GENERIC_PIN_FAIL };
    }
    const accountName = matchedUser.username || matchedUser.id;
    if (matchedPinResult === 'ok-legacy' && matchedUser.docRef) {
        await matchedUser.docRef.update({ pinHash: (0, security_1.hashPassword)(pin) });
        firebase_functions_1.logger.info(`Upgraded legacy staff PIN hash to scrypt for ${accountName}`);
    }
    await (0, security_1.clearLoginAttempts)(pinRateKey);
    const { role, customToken } = await createStaffToken(accountName, matchedUser.role);
    firebase_functions_1.logger.info(`Staff PIN login successful for ${accountName} as ${role}`);
    return { success: true, username: accountName, role, customToken };
}
async function verifyPasswordLogin(db, usernameRaw, password) {
    if (!usernameRaw || !password) {
        throw new https_1.HttpsError('invalid-argument', GENERIC_FAIL);
    }
    const username = (0, security_1.cleanStr)(usernameRaw, 64, 'username');
    if (!/^[a-z0-9._-]{2,64}$/.test(username))
        throw new https_1.HttpsError('invalid-argument', GENERIC_FAIL);
    const rateKey = `staff:${username}`;
    await (0, security_1.checkRateLimit)(rateKey);
    const fail = async () => {
        await (0, security_1.recordLoginFailure)(rateKey);
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
    if (result === 'ok-legacy') {
        await staffRef.update({ passwordHash: (0, security_1.hashPassword)(password) });
        firebase_functions_1.logger.info('Upgraded legacy staff password hash to scrypt');
    }
    await (0, security_1.clearLoginAttempts)(rateKey);
    await staffRef.update({ lastLoginAt: firestore_1.FieldValue.serverTimestamp() }).catch(() => { });
    const { role, customToken } = await createStaffToken(username, data.role);
    firebase_functions_1.logger.info('Staff login successful');
    return { success: true, username: data.username || username, role, customToken };
}
exports.verifyStaff = (0, https_1.onCall)(async (request) => {
    const pin = typeof request.data?.pin === 'string' ? request.data.pin.trim() : null;
    const usernameRaw = typeof request.data?.username === 'string' ? request.data.username.trim().toLowerCase() : null;
    const password = typeof request.data?.password === 'string' ? request.data.password : null;
    const db = (0, firestore_1.getFirestore)();
    await ensureStaffSeeded(db);
    if (pin)
        return verifyPinLogin(db, request, pin);
    return verifyPasswordLogin(db, usernameRaw, password);
});
exports.updateStaffPin = (0, https_1.onCall)(async (request) => {
    const uid = (0, security_1.requireStaff)(request);
    const newPin = (0, security_1.cleanStr)(request.data?.newPin, 16, 'newPin');
    if (!PIN_RE.test(newPin)) {
        throw new https_1.HttpsError('invalid-argument', 'PIN must be between 4 and 8 digits');
    }
    const username = uid.replace(/^staff_/, '');
    const db = (0, firestore_1.getFirestore)();
    const staffRef = db.collection('staff_accounts').doc(username);
    const doc = await staffRef.get();
    if (!doc.exists) {
        throw new https_1.HttpsError('not-found', 'Staff account not found');
    }
    const allStaff = await db.collection('staff_accounts').get();
    for (const other of allStaff.docs) {
        if (other.id === username)
            continue;
        const otherHash = other.data().pinHash;
        if (typeof otherHash === 'string' && otherHash && (0, security_1.verifyPassword)(newPin, otherHash) !== 'bad') {
            throw new https_1.HttpsError('already-exists', 'This PIN is already in use by another account');
        }
    }
    await staffRef.update({
        pinHash: (0, security_1.hashPassword)(newPin),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    firebase_functions_1.logger.info(`Updated PIN for staff account ${username}`);
    return { success: true };
});
//# sourceMappingURL=verify_staff.js.map