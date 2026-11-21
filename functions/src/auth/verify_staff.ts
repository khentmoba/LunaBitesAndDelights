import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import {
  cleanStr, checkRateLimit, recordLoginFailure, clearLoginAttempts,
  checkWindowBudget, recordWindowFailure, clientIpFromRequest, enforceFixedWindowRateLimit,
  hashPasswordAsync, verifyPasswordAsync, requireStaff,
} from '../util/security';

const GENERIC_FAIL = 'Invalid username or password';
const GENERIC_PIN_FAIL = 'Invalid PIN. Please try again.';
const PIN_RE = /^[0-9]{4,8}$/;
const PIN_VERIFY_CONCURRENCY = 2;
const GLOBAL_PIN_FAIL_KEY = 'staff:pin_login:global';
const GLOBAL_PIN_FAIL_MAX = 20;
const GLOBAL_PIN_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_IP_RATE_MAX = 30;
const PASSWORD_IP_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_PASSWORD_FAIL_KEY = 'staff:pw_login:global';
const GLOBAL_PASSWORD_FAIL_MAX = 60;
const USER_PASSWORD_FAIL_MAX = 20;
const PASSWORD_FAIL_WINDOW_MS = 15 * 60 * 1000;
let staffSeeded = false;

export interface PinAccountEntry<T = any> {
  id: string;
  pinHash?: unknown;
  payload: T;
}

/** Verifies a PIN against candidate staff accounts with bounded concurrency. */
export async function findMatchingPinAccount<T>(
  pin: string,
  entries: readonly PinAccountEntry<T>[],
  verify: (pin: string, hash: string) => Promise<'ok' | 'ok-legacy' | 'bad'> = verifyPasswordAsync,
  concurrency = PIN_VERIFY_CONCURRENCY,
): Promise<{ entry: PinAccountEntry<T>; result: 'ok' | 'ok-legacy' } | null> {
  const candidates = entries.filter((e) => typeof e.pinHash === 'string' && e.pinHash.length > 0);
  const step = Math.max(1, concurrency);
  for (let i = 0; i < candidates.length; i += step) {
    const batch = candidates.slice(i, i + step);
    const results = await Promise.all(
      batch.map(async (entry) => ({ entry, result: await verify(pin, entry.pinHash as string) })),
    );
    const hit = results.find((r) => r.result !== 'bad');
    if (hit) return { entry: hit.entry, result: hit.result as 'ok' | 'ok-legacy' };
  }
  return null;
}

async function ensureStaffSeeded(db: Firestore): Promise<void> {
  if (staffSeeded) return;
  if (!(await db.collection('staff_accounts').limit(1).get()).empty) {
    staffSeeded = true;
    return;
  }
  const mk = () => crypto.randomBytes(9).toString('base64url');
  const mkPin = () => String(crypto.randomInt(100000, 1000000));
  const seeds = [
    { username: 'admin', role: 'admin', pin: mkPin() },
    { username: 'staff1', role: 'staff', pin: mkPin() },
  ];
  const batch = db.batch();
  for (const s of seeds) {
    const pw = mk();
    const [passwordHash, pinHash] = await Promise.all([
      hashPasswordAsync(pw),
      hashPasswordAsync(s.pin),
    ]);
    batch.set(db.collection('staff_accounts').doc(s.username), {
      username: s.username,
      role: s.role,
      passwordHash,
      pinHash,
      createdAt: new Date(),
    });
    logger.warn(`SEEDED staff account ${s.username} (role: ${s.role}); run functions/scripts/reset-staff-credentials.js to set credentials`);
  }
  await batch.commit();
  staffSeeded = true;
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
  const clientIp = clientIpFromRequest(request.rawRequest);
  const pinRateKey = clientIp ? `staff:pin_login:${clientIp}` : 'staff:pin_login';
  await checkRateLimit(pinRateKey);
  await checkWindowBudget(
    GLOBAL_PIN_FAIL_KEY,
    GLOBAL_PIN_FAIL_MAX,
    GLOBAL_PIN_WINDOW_MS,
    'Too many failed PIN attempts. Please sign in with username and password.',
  );

  const staffAccounts = await db.collection('staff_accounts').get();
  const match = await findMatchingPinAccount(
    pin,
    staffAccounts.docs.map((doc) => {
      const d = doc.data();
      return { id: doc.id, pinHash: d.pinHash, payload: { id: doc.id, docRef: doc.ref, data: d } };
    }),
  );

  if (!match) {
    logger.info('Staff PIN login failed: bad PIN');
    await Promise.all([
      recordLoginFailure(pinRateKey),
      recordWindowFailure(GLOBAL_PIN_FAIL_KEY, GLOBAL_PIN_WINDOW_MS),
    ]);
    return { success: false, message: GENERIC_PIN_FAIL };
  }

  const matchedUser = match.entry.payload;
  const matchedPinResult = match.result;

  const accountName = String(matchedUser.data.username || matchedUser.id);
  if (matchedPinResult === 'ok-legacy' && matchedUser.docRef) {
    await matchedUser.docRef.update({ pinHash: await hashPasswordAsync(pin) });
    logger.info(`Upgraded legacy staff PIN hash to scrypt for ${accountName}`);
  }

  await clearLoginAttempts(pinRateKey);
  const { role, customToken } = await createStaffToken(accountName, matchedUser.data.role);
  logger.info(`Staff PIN login successful for ${accountName} as ${role}`);
  return { success: true, username: accountName, role, customToken };
}

async function verifyPasswordLogin(
  db: Firestore,
  request: CallableRequest,
  usernameRaw: string | null,
  password: string | null,
) {
  const clientIp = clientIpFromRequest(request.rawRequest) || 'unknown';
  await enforceFixedWindowRateLimit(
    `staff:pw_ip:${clientIp}`,
    PASSWORD_IP_RATE_MAX,
    PASSWORD_IP_WINDOW_MS,
    'Too many login attempts from this network. Please try again later.',
  );

  if (!usernameRaw || !password) {
    throw new HttpsError('invalid-argument', GENERIC_FAIL);
  }

  const username = cleanStr(usernameRaw, 64, 'username');
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) throw new HttpsError('invalid-argument', GENERIC_FAIL);

  const rateKey = `staff:${username}:${clientIp}`;
  const userBudgetKey = `staff:pw_user:${username}`;
  await Promise.all([
    checkRateLimit(rateKey),
    checkWindowBudget(
      userBudgetKey,
      USER_PASSWORD_FAIL_MAX,
      PASSWORD_FAIL_WINDOW_MS,
      'Too many failed login attempts for this account. Try again in 15 minutes.',
    ),
    checkWindowBudget(
      GLOBAL_PASSWORD_FAIL_KEY,
      GLOBAL_PASSWORD_FAIL_MAX,
      PASSWORD_FAIL_WINDOW_MS,
      'Too many failed login attempts. Try again in 15 minutes.',
    ),
  ]);
  const fail = async () => {
    await Promise.all([
      recordLoginFailure(rateKey),
      recordWindowFailure(userBudgetKey, PASSWORD_FAIL_WINDOW_MS),
      recordWindowFailure(GLOBAL_PASSWORD_FAIL_KEY, PASSWORD_FAIL_WINDOW_MS),
    ]);
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

  const result = await verifyPasswordAsync(password, data.passwordHash);
  if (result === 'bad') {
    logger.info('Staff login failed: bad password');
    return fail();
  }

  if (result === 'ok-legacy') {
    await staffRef.update({ passwordHash: await hashPasswordAsync(password) });
    logger.info('Upgraded legacy staff password hash to scrypt');
  }

  await clearLoginAttempts(rateKey);
  await staffRef.update({ lastLoginAt: FieldValue.serverTimestamp() }).catch(() => {});

  const { role, customToken } = await createStaffToken(username, data.role);
  logger.info('Staff login successful');
  return { success: true, username: data.username || username, role, customToken };
}

export const verifyStaff = onCall(
  { memory: '512MiB', concurrency: 10 },
  async (request) => {
  const pin = typeof request.data?.pin === 'string' ? request.data.pin.trim() : null;
  const usernameRaw = typeof request.data?.username === 'string' ? request.data.username.trim().toLowerCase() : null;
  const password = typeof request.data?.password === 'string' ? request.data.password : null;

  const db = getFirestore();
  await ensureStaffSeeded(db);

  if (pin) return verifyPinLogin(db, request, pin);
  return verifyPasswordLogin(db, request, usernameRaw, password);
});

export const updateStaffPin = onCall(
  { memory: '512MiB', concurrency: 10 },
  async (request) => {
  const uid = requireStaff(request);
  const updateRateKey = `staff:pin_update:${uid}`;
  await checkRateLimit(updateRateKey);

  const currentPassword = cleanStr(request.data?.currentPassword, 200, 'currentPassword');
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

  const data = doc.data()!;
  if (!data.passwordHash) {
    throw new HttpsError('internal', 'Server misconfigured');
  }
  const pwCheck = await verifyPasswordAsync(currentPassword, data.passwordHash);
  if (pwCheck === 'bad') {
    await recordLoginFailure(updateRateKey);
    throw new HttpsError('permission-denied', 'Invalid current password');
  }

  const allStaff = await db.collection('staff_accounts').get();
  const conflict = await findMatchingPinAccount(
    newPin,
    allStaff.docs
      .filter((other) => other.id !== username)
      .map((other) => ({ id: other.id, pinHash: other.data().pinHash, payload: other.id })),
  );
  if (conflict) {
    await recordLoginFailure(updateRateKey);
    throw new HttpsError('invalid-argument', 'Unable to set this PIN. Please choose a different PIN.');
  }

  await clearLoginAttempts(updateRateKey);
  const updatePayload: Record<string, any> = {
    pinHash: await hashPasswordAsync(newPin),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (pwCheck === 'ok-legacy') {
    updatePayload.passwordHash = await hashPasswordAsync(currentPassword);
  }
  await staffRef.update(updatePayload);
  logger.info(`Updated PIN for staff account ${username}`);
  return { success: true };
});
