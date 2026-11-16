import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import {
  cleanStr, checkRateLimit, recordLoginFailure, clearLoginAttempts,
  hashPassword, verifyPassword, requireStaff,
} from '../util/security';

const GENERIC_FAIL = 'Invalid username or password';
const GENERIC_PIN_FAIL = 'Invalid PIN. Please try again.';
const PIN_RE = /^[0-9]{4,8}$/;

async function ensureStaffSeeded(db: Firestore): Promise<void> {
  if (!(await db.collection('staff_accounts').limit(1).get()).empty) return;
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
      passwordHash: hashPassword(pw),
      pinHash: hashPassword(s.pin),
      createdAt: new Date(),
    });
    logger.warn(`SEEDED staff account ${s.username} password: ${pw}, pin: ${s.pin} — CHANGE AFTER FIRST LOGIN`);
  }
  await batch.commit();
}

async function createStaffToken(uidName: string, rawRole: unknown) {
  const role = rawRole === 'admin' ? 'admin' : 'staff';
  const customToken = await getAuth().createCustomToken(`staff_${uidName}`, { role });
  return { role, customToken };
}

async function verifyPinLogin(db: Firestore, request: CallableRequest, pin: string) {
  if (!PIN_RE.test(pin)) {
    throw new HttpsError('invalid-argument', GENERIC_PIN_FAIL);
  }
  const clientIp = typeof request.rawRequest?.ip === 'string' && request.rawRequest.ip
    ? request.rawRequest.ip
    : '';
  const pinRateKey = clientIp ? `staff:pin_login:${clientIp}` : 'staff:pin_login';
  await checkRateLimit(pinRateKey);

  const staffAccounts = await db.collection('staff_accounts').get();
  let matchedUser: any = null;
  let matchedPinResult: 'ok' | 'ok-legacy' = 'ok';

  for (const doc of staffAccounts.docs) {
    const d = doc.data();
    if (!d.pinHash) continue;
    const pinRes = verifyPassword(pin, d.pinHash);
    if (pinRes !== 'bad') {
      matchedUser = { id: doc.id, docRef: doc.ref, ...d };
      matchedPinResult = pinRes;
      break;
    }
  }

  if (!matchedUser) {
    logger.info('Staff PIN login failed: bad PIN');
    await recordLoginFailure(pinRateKey);
    return { success: false, message: GENERIC_PIN_FAIL };
  }

  const accountName = matchedUser.username || matchedUser.id;
  if (matchedPinResult === 'ok-legacy' && matchedUser.docRef) {
    await matchedUser.docRef.update({ pinHash: hashPassword(pin) });
    logger.info(`Upgraded legacy staff PIN hash to scrypt for ${accountName}`);
  }

  await clearLoginAttempts(pinRateKey);
  const { role, customToken } = await createStaffToken(accountName, matchedUser.role);
  logger.info(`Staff PIN login successful for ${accountName} as ${role}`);
  return { success: true, username: accountName, role, customToken };
}

async function verifyPasswordLogin(db: Firestore, usernameRaw: string | null, password: string | null) {
  if (!usernameRaw || !password) {
    throw new HttpsError('invalid-argument', GENERIC_FAIL);
  }

  const username = cleanStr(usernameRaw, 64, 'username');
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) throw new HttpsError('invalid-argument', GENERIC_FAIL);

  const rateKey = `staff:${username}`;
  await checkRateLimit(rateKey);
  const fail = async () => {
    await recordLoginFailure(rateKey);
    return { success: false, message: GENERIC_FAIL };
  };

  const staffRef = db.collection('staff_accounts').doc(username);
  const doc = await staffRef.get();
  if (!doc.exists) {
    logger.info('Staff login failed: unknown user');
    return fail();
  }

  const data = doc.data()!;
  if (!data.passwordHash) {
    logger.error('Staff account missing passwordHash');
    throw new HttpsError('internal', 'Server misconfigured');
  }

  const result = verifyPassword(password, data.passwordHash);
  if (result === 'bad') {
    logger.info('Staff login failed: bad password');
    return fail();
  }

  if (result === 'ok-legacy') {
    await staffRef.update({ passwordHash: hashPassword(password) });
    logger.info('Upgraded legacy staff password hash to scrypt');
  }

  await clearLoginAttempts(rateKey);
  await staffRef.update({ lastLoginAt: FieldValue.serverTimestamp() }).catch(() => {});

  const { role, customToken } = await createStaffToken(username, data.role);
  logger.info('Staff login successful');
  return { success: true, username: data.username || username, role, customToken };
}

export const verifyStaff = onCall(async (request) => {
  const pin = typeof request.data?.pin === 'string' ? request.data.pin.trim() : null;
  const usernameRaw = typeof request.data?.username === 'string' ? request.data.username.trim().toLowerCase() : null;
  const password = typeof request.data?.password === 'string' ? request.data.password : null;

  const db = getFirestore();
  await ensureStaffSeeded(db);

  if (pin) return verifyPinLogin(db, request, pin);
  return verifyPasswordLogin(db, usernameRaw, password);
});

export const updateStaffPin = onCall(async (request) => {
  const uid = requireStaff(request);
  const newPin = cleanStr(request.data?.newPin, 16, 'newPin');
  if (!PIN_RE.test(newPin)) {
    throw new HttpsError('invalid-argument', 'PIN must be between 4 and 8 digits');
  }

  const username = uid.replace(/^staff_/, '');
  const db = getFirestore();
  const staffRef = db.collection('staff_accounts').doc(username);
  const doc = await staffRef.get();
  if (!doc.exists) {
    throw new HttpsError('not-found', 'Staff account not found');
  }

  const allStaff = await db.collection('staff_accounts').get();
  for (const other of allStaff.docs) {
    if (other.id === username) continue;
    const otherHash = other.data().pinHash;
    if (typeof otherHash === 'string' && otherHash && verifyPassword(newPin, otherHash) !== 'bad') {
      throw new HttpsError('already-exists', 'This PIN is already in use by another account');
    }
  }

  await staffRef.update({
    pinHash: hashPassword(newPin),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info(`Updated PIN for staff account ${username}`);
  return { success: true };
});
