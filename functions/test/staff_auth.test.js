const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync } = require('../lib/util/security');
const { findMatchingPinAccount } = require('../lib/auth/verify_staff');
const { isCountableOrder } = require('../lib/util');

describe('staff auth: scrypt PIN and password verification', () => {
  test('hashes and verifies a 4-digit PIN', () => {
    const staffPin = '8888';
    const staffHash = hashPassword(staffPin);
    assert.ok(staffHash.startsWith('scrypt$'), 'Hash should be formatted as scrypt');
    assert.equal(verifyPassword(staffPin, staffHash), 'ok');
    assert.equal(verifyPassword('0000', staffHash), 'bad');

    const adminPin = '0524';
    const adminHash = hashPassword(adminPin);
    assert.equal(verifyPassword(adminPin, adminHash), 'ok');
    assert.equal(verifyPassword('1234', adminHash), 'bad');
  });

  test('hashes and verifies a staff password', () => {
    const pw = 'superSecretStaffPass123';
    const hash = hashPassword(pw);
    assert.equal(verifyPassword(pw, hash), 'ok');
    assert.equal(verifyPassword('wrongPassword', hash), 'bad');
  });

  test('timing-safe comparison rejects tampered or mismatched-length hash cleanly', () => {
    const hash = hashPassword('1234');
    const tampered = hash.slice(0, -4) + '0000';
    assert.equal(verifyPassword('1234', tampered), 'bad');
    assert.equal(verifyPassword('1234', 'scrypt$ab$short'), 'bad');
    assert.equal(verifyPassword('1234', 'scrypt$ab$' + 'g'.repeat(64)), 'bad');
    assert.equal(verifyPassword('1234', 'too-short-legacy'), 'bad');
  });

  test('async scrypt hashes and verifies without blocking', async () => {
    const hash = await hashPasswordAsync('2468');
    assert.ok(hash.startsWith('scrypt$'));
    assert.equal(await verifyPasswordAsync('2468', hash), 'ok');
    assert.equal(await verifyPasswordAsync('9999', hash), 'bad');
  });

  test('isCountableOrder excludes cancelled and unpaid/failed GCash orders', () => {
    assert.equal(isCountableOrder({ status: 'Pending', paymentMethod: 'Cash', paymentStatus: 'NOT PAID' }), true);
    assert.equal(isCountableOrder({ status: 'Completed', paymentMethod: 'GCash', paymentStatus: 'PAID' }), true);
    assert.equal(isCountableOrder({ status: 'Cancelled', paymentMethod: 'Cash', paymentStatus: 'NOT PAID' }), false);
    assert.equal(isCountableOrder({ status: 'Pending', paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' }), false);
    assert.equal(isCountableOrder({ status: 'Pending', paymentMethod: 'GCash', paymentStatus: 'PAYMENT_FAILED' }), false);
  });

  test('findMatchingPinAccount verifies candidate accounts in parallel batches', async () => {
    const hashA = await hashPasswordAsync('1111');
    const hashB = await hashPasswordAsync('2222');
    const entries = [
      { id: 'no-pin', pinHash: null, payload: 'no-pin' },
      { id: 'staff1', pinHash: hashA, payload: 'staff1' },
      { id: 'admin', pinHash: hashB, payload: 'admin' },
    ];
    let inFlight = 0;
    let peak = 0;
    const trackedVerify = async (pin, hash) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await verifyPasswordAsync(pin, hash);
      } finally {
        inFlight -= 1;
      }
    };
    const match = await findMatchingPinAccount('2222', entries, trackedVerify, 4);
    assert.equal(match?.entry.id, 'admin');
    assert.equal(match?.result, 'ok');
    assert.ok(peak >= 2, `expected parallel verification, peak concurrency was ${peak}`);

    const miss = await findMatchingPinAccount('9999', entries, verifyPasswordAsync, 4);
    assert.equal(miss, null);
  });

  test('resetStaffCredentials hashes password and PIN and writes staff_accounts doc', async () => {
    const { resetStaffCredentials } = require('../scripts/reset-staff-credentials');
    let written = null;
    const fakeDb = {
      collection(name) {
        assert.equal(name, 'staff_accounts');
        return {
          doc(id) {
            return {
              async set(data, opts) {
                written = { id, data, opts };
              },
            };
          },
        };
      },
    };

    const res = await resetStaffCredentials(fakeDb, {
      username: ' Admin ',
      role: 'admin',
      password: 'NewStrongPassword1',
      pin: '123456',
    });
    assert.deepEqual(res, {
      username: 'admin',
      role: 'admin',
      passwordUpdated: true,
      pinUpdated: true,
    });
    assert.equal(written.id, 'admin');
    assert.deepEqual(written.opts, { merge: true });
    assert.equal(await verifyPasswordAsync('NewStrongPassword1', written.data.passwordHash), 'ok');
    assert.equal(await verifyPasswordAsync('123456', written.data.pinHash), 'ok');
    await assert.rejects(
      resetStaffCredentials(fakeDb, { username: 'a', pin: '1234' }),
      /Invalid --username/,
    );
    await assert.rejects(
      resetStaffCredentials(fakeDb, { username: 'admin', pin: '12' }),
      /Invalid PIN/,
    );
  });

  test('rejects malformed or non-64-hex scrypt hashes', async () => {
    const { verifyPassword } = require('../lib/util/security');
    const oddHex = `scrypt$abcd$${'a'.repeat(65)}`;
    const shortHex = `scrypt$abcd$${'a'.repeat(32)}`;
    assert.equal(verifyPassword('secret', oddHex), 'bad');
    assert.equal(verifyPassword('secret', shortHex), 'bad');
    assert.equal(await verifyPasswordAsync('secret', oddHex), 'bad');
    assert.equal(await verifyPasswordAsync('secret', shortHex), 'bad');
  });

  test('isValidPasswordInput caps password length to prevent scrypt DoS', () => {
    const { isValidPasswordInput, MAX_PASSWORD_LENGTH } = require('../lib/auth/verify_staff');
    assert.equal(isValidPasswordInput('validPass123'), true);
    assert.equal(isValidPasswordInput('a'.repeat(MAX_PASSWORD_LENGTH)), true);
    assert.equal(isValidPasswordInput('a'.repeat(MAX_PASSWORD_LENGTH + 1)), false);
    assert.equal(isValidPasswordInput(''), false);
    assert.equal(isValidPasswordInput(null), false);
    assert.equal(isValidPasswordInput(12345), false);
  });

  test('parseCurrentPassword preserves leading/trailing whitespace and rejects invalid inputs', () => {
    const { parseCurrentPassword, MAX_PASSWORD_LENGTH } = require('../lib/auth/verify_staff');
    assert.equal(parseCurrentPassword('  spaced pass  '), '  spaced pass  ');
    assert.throws(() => parseCurrentPassword(''), /Missing or invalid currentPassword/);
    assert.throws(() => parseCurrentPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)), /Missing or invalid currentPassword/);
    assert.throws(() => parseCurrentPassword(null), /Missing or invalid currentPassword/);
  });

  test('staffAuthUid derives the Firebase Auth UID from the staff_accounts doc id', () => {
    const { staffAuthUid } = require('../lib/auth/verify_staff');
    assert.equal(staffAuthUid('admin'), 'staff_admin');
    assert.equal(staffAuthUid('staff1'), 'staff_staff1');
  });

  test('staffDocIdFromUid validates prefix and document id format', () => {
    const { staffDocIdFromUid } = require('../lib/auth/verify_staff');
    assert.equal(staffDocIdFromUid('staff_admin'), 'admin');
    assert.equal(staffDocIdFromUid('staff_cook.1-a'), 'cook.1-a');
    for (const bad of ['', 'admin', 'staff_', 'staff_a', 'staff_../other', 'staff_a/b', 'staff_has space']) {
      assert.throws(() => staffDocIdFromUid(bad), /Invalid staff account/, `expected rejection for ${JSON.stringify(bad)}`);
    }
  });

  test('verifyStaff enforces and clears per-username password failure budget across rotating IPs', async () => {
    const firestoreMod = require('firebase-admin/firestore');
    const authMod = require('firebase-admin/auth');
    const { verifyStaff } = require('../lib/auth/verify_staff');
    const origGetFirestore = firestoreMod.getFirestore;
    const origGetAuth = authMod.getAuth;
    const store = new Map();
    const adminHash = await hashPasswordAsync('correct-password');
    store.set('staff_accounts/admin', { username: 'admin', role: 'admin', passwordHash: adminHash });

    const docRef = (col, id) => {
      const key = `${col}/${id}`;
      return {
        id,
        async get() {
          const data = store.get(key);
          return { exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
        },
        async set(payload, opts) {
          const prev = opts?.merge ? (store.get(key) || {}) : {};
          store.set(key, { ...prev, ...payload });
        },
        async update(payload) {
          const prev = store.get(key) || {};
          store.set(key, { ...prev, ...payload });
        },
        async delete() {
          store.delete(key);
        },
      };
    };
    const fakeDb = {
      collection(name) {
        return {
          doc: (id) => docRef(name, id),
          limit: () => ({
            async get() {
              const hasStaff = [...store.keys()].some((k) => k.startsWith(`${name}/`));
              return { empty: !hasStaff };
            },
          }),
        };
      },
      async runTransaction(fn) {
        const tx = {
          get: (ref) => ref.get(),
          set: (ref, payload, opts) => { ref.set(payload, opts); },
          delete: (ref) => { ref.delete(); },
        };
        return fn(tx);
      },
    };

    firestoreMod.getFirestore = () => fakeDb;
    authMod.getAuth = () => ({ createCustomToken: async () => 'fake-custom-token' });
    try {
      // A few failures followed by a proven valid login must clear the per-account budget.
      for (let i = 1; i <= 3; i++) {
        const res = await verifyStaff.run({
          data: { username: 'admin', password: `wrong-pre-${i}` },
          rawRequest: { headers: { 'x-forwarded-for': `198.51.100.${i}` } },
        });
        assert.equal(res.success, false);
      }
      const userBudgetEntry = [...store.entries()].find(([k, v]) => k.startsWith('rate_limits/') && v?.count === 3);
      assert.ok(userBudgetEntry, 'expected per-account failure budget doc with count 3');
      const okRes = await verifyStaff.run({
        data: { username: 'admin', password: 'correct-password' },
        rawRequest: { headers: { 'x-forwarded-for': '198.51.100.99' } },
      });
      assert.equal(okRes.success, true);
      assert.equal(store.has(userBudgetEntry[0]), false, 'successful password login must clear per-account failure budget');

      // 20 consecutive failures across rotating IPs must exhaust the per-account budget.
      for (let i = 1; i <= 20; i++) {
        const res = await verifyStaff.run({
          data: { username: 'admin', password: `wrong-${i}` },
          rawRequest: { headers: { 'x-forwarded-for': `203.0.113.${i}` } },
        });
        assert.equal(res.success, false);
      }
      await assert.rejects(
        verifyStaff.run({
          data: { username: 'admin', password: 'correct-password' },
          rawRequest: { headers: { 'x-forwarded-for': '203.0.113.200' } },
        }),
        /Too many failed login attempts for this account/,
      );
    } finally {
      firestoreMod.getFirestore = origGetFirestore;
      authMod.getAuth = origGetAuth;
    }
  });
});
