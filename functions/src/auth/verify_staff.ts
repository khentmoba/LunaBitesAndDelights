import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import {
  cleanStr, checkRateLimit, recordLoginFailure, clearLoginAttempts,
  hashPassword, verifyPassword, requireStaff,
} from '../util/security';

const GENERIC_FAIL = 'Invalid username or password';
const GENERIC_PIN_FAIL = 'Invalid PIN. Please try again.';

export const verifyStaff = onCall(async (request) => {
  const pin = typeof request.data?.pin === 'string' ? request.data.pin.trim() : null;
  const usernameRaw = typeof request.data?.username === 'string' ? request.data.username.trim().toLowerCase() : null;
  const password = typeof request.data?.password === 'string' ? request.data.password : null;

  const db = getFirestore();

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
        passwordHash: hashPassword(pw),
        pinHash: hashPassword(s.pin),
        createdAt: new Date(),
      });
      logger.warn(`SEEDED staff account ${s.username} password: ${pw}, pin: ${s.pin} — CHANGE AFTER FIRST LOGIN`);
    }
    await batch.commit();
  }

  // ── Quick PIN Login Flow ──
  if (pin) {
    if (!/^[0-9]{4,8}$/.test(pin)) {
      throw new HttpsError('invalid-argument', GENERIC_PIN_FAIL);
    }
    await checkRateLimit('staff:pin_login');
    const failPin = async () => {
      await recordLoginFailure('staff:pin_login');
      return { success: false, message: GENERIC_PIN_FAIL };
    };

    const staffAccounts = await db.collection('staff_accounts').get();
    let matchedUser: any = null;

    if (!staffAccounts.empty) {
      for (const doc of staffAccounts.docs) {
        const d = doc.data();
        if (d.pinHash && verifyPassword(pin, d.pinHash) !== 'bad') {
          matchedUser = { id: doc.id, ...d };
          break;
        }
      }
    }

    if (!matchedUser) {
      logger.info('Staff PIN login failed: bad PIN');
      return failPin();
    }

    await clearLoginAttempts('staff:pin_login');
    const role = matchedUser.role === 'admin' ? 'admin' : 'staff';
    const customToken = await getAuth().createCustomToken(`staff_${matchedUser.username || matchedUser.id}`, { role });
    logger.info(`Staff PIN login successful for ${matchedUser.username || matchedUser.id} as ${role}`);
    return { success: true, username: matchedUser.username || matchedUser.id, role, customToken };
  }

  // ── Username + Password Flow ──
  if (!usernameRaw || !password) {
    throw new HttpsError('invalid-argument', GENERIC_FAIL);
  }

  const username = cleanStr(usernameRaw, 64, 'username');
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) throw new HttpsError('invalid-argument', GENERIC_FAIL);

  // #11 rate limit login (lockout after 5 failures)
  await checkRateLimit(`staff:${username}`);
  const fail = async () => {
    await recordLoginFailure(`staff:${username}`);
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

  // Auto-upgrade legacy sha256 hashes to scrypt (#10)
  if (result === 'ok-legacy') {
    await staffRef.update({ passwordHash: hashPassword(password) });
    logger.info('Upgraded legacy staff password hash to scrypt');
  }

  await clearLoginAttempts(`staff:${username}`);
  await staffRef.update({ lastLoginAt: FieldValue.serverTimestamp() }).catch(() => {});

  // #6 + #9: issue a real Firebase session (custom token with staff claim)
  // instead of a bare {success:true} the client could forge.
  const role = data.role === 'admin' ? 'admin' : 'staff';
  const customToken = await getAuth().createCustomToken(`staff_${username}`, { role });
  logger.info('Staff login successful');
  return { success: true, username: data.username || username, role, customToken };
});

export const updateStaffPin = onCall(async (request) => {
  const uid = requireStaff(request);
  const newPin = cleanStr(request.data?.newPin, 16, 'newPin');
  if (!/^[0-9]{4,8}$/.test(newPin)) {
    throw new HttpsError('invalid-argument', 'PIN must be between 4 and 8 digits');
  }

  const username = uid.replace(/^staff_/, '');
  const db = getFirestore();
  const staffRef = db.collection('staff_accounts').doc(username);
  const doc = await staffRef.get();
  if (!doc.exists) {
    throw new HttpsError('not-found', 'Staff account not found');
  }

  await staffRef.update({
    pinHash: hashPassword(newPin),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info(`Updated PIN for staff account ${username}`);
  return { success: true };
});
