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
});
