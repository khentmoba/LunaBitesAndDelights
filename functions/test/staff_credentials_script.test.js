// The credential reset script is the second way staff PINs get set (the first
// is updateStaffPin). PIN sign-in scans accounts and signs in as the first
// match, so a PIN shared with another account can hand a staffer the admin
// session; the script must refuse it exactly like the callable does.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, resetStaffCredentials, findPinOwner } = require('../scripts/reset-staff-credentials');
const { hashPasswordAsync } = require('../lib/util/security');

/** Minimal stand-in for the Firestore surface the script touches. */
function fakeDb(accounts = {}) {
  const docs = new Map(Object.entries(accounts).map(([id, data]) => [id, { ...data }]));
  const writes = [];
  return {
    docs,
    writes,
    collection(name) {
      assert.equal(name, 'staff_accounts');
      const query = {
        select() {
          return query;
        },
        limit() {
          return query;
        },
        async get() {
          return {
            docs: [...docs.entries()].map(([id, data]) => ({ id, get: (field) => data[field] })),
          };
        },
      };
      return {
        ...query,
        doc(id) {
          return {
            async set(update, options) {
              writes.push({ id, update, options });
              docs.set(id, { ...(docs.get(id) || {}), ...update });
            },
          };
        },
      };
    },
  };
}

describe('reset-staff-credentials script', () => {
  test('parses the documented flags', () => {
    assert.deepEqual(parseArgs(['--username', 'admin', '--role', 'admin', '--pin', '654321']), {
      username: 'admin',
      role: 'admin',
      pin: '654321',
    });
  });

  test('refuses a PIN that another account already uses', async () => {
    const db = fakeDb({
      admin: { pinHash: await hashPasswordAsync('0524') },
      staff1: { pinHash: await hashPasswordAsync('8888') },
    });
    assert.equal(await findPinOwner(db, '8888', 'staff1'), null, 'the account being updated does not count');
    assert.equal(await findPinOwner(db, '8888', 'admin'), 'staff1');
    await assert.rejects(
      resetStaffCredentials(db, { username: 'admin', pin: '8888' }),
      /already used by staff account "staff1"/,
    );
    assert.equal(db.writes.length, 0, 'nothing may be written when the PIN is rejected');
  });

  test('allows the account to keep its own PIN while rotating the password', async () => {
    const db = fakeDb({ admin: { pinHash: await hashPasswordAsync('0524'), role: 'admin' } });
    const result = await resetStaffCredentials(db, { username: 'admin', password: 'aFreshPassword1', pin: '0524' });
    assert.equal(result.username, 'admin');
    assert.equal(result.passwordUpdated, true);
    assert.equal(result.pinUpdated, true);
    assert.equal(db.writes.length, 1);
    const write = db.writes[0];
    assert.equal(write.id, 'admin');
    assert.equal(write.options.merge, true);
    assert.ok(String(write.update.passwordHash).startsWith('scrypt$'));
    assert.ok(String(write.update.pinHash).startsWith('scrypt$'));
  });

  test('rejects malformed usernames, roles and PINs before any write', async () => {
    const db = fakeDb();
    await assert.rejects(resetStaffCredentials(db, { username: 'a', pin: '1234' }), /Invalid --username/);
    await assert.rejects(resetStaffCredentials(db, { username: 'admin', role: 'owner', pin: '1234' }), /Invalid --role/);
    await assert.rejects(resetStaffCredentials(db, { username: 'admin', pin: '12' }), /Invalid PIN/);
    await assert.rejects(resetStaffCredentials(db, { username: 'admin' }), /Provide at least one/);
    assert.equal(db.writes.length, 0);
  });
});
