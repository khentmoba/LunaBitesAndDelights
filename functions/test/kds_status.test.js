// The kitchen board must answer for the document its transaction actually
// read: a duplicate tap on a status column is not a status change, and a
// response that claims otherwise makes the tablet resync against a stale view.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { applyOrderStatus } = require('../lib/orders/kds');

function fakeDb(current) {
  const writes = [];
  return {
    writes,
    async runTransaction(fn) {
      return fn({
        async get() {
          return { exists: current !== undefined, data: () => current };
        },
        update(_ref, patch) {
          writes.push(patch);
        },
      });
    },
  };
}

const orderRef = { id: 'ord1' };

describe('applyOrderStatus', () => {
  test('moves Pending to Preparing and reports the previous status', async () => {
    const db = fakeDb({ status: 'Pending' });
    const outcome = await applyOrderStatus(db, orderRef, 'Preparing', '');
    assert.deepEqual(outcome, { changed: true, previousStatus: 'Pending' });
    assert.deepEqual(db.writes, [{ status: 'Preparing' }]);
  });

  test('a duplicate tap writes nothing and reports no change', async () => {
    const db = fakeDb({ status: 'Preparing' });
    const outcome = await applyOrderStatus(db, orderRef, 'Preparing', '');
    assert.deepEqual(outcome, { changed: false, previousStatus: 'Preparing' });
    assert.deepEqual(db.writes, []);
  });

  test('a repeated cancel with a new reason records the reason', async () => {
    const db = fakeDb({ status: 'Cancelled', cancellationReason: 'Item Out of Stock' });
    const outcome = await applyOrderStatus(db, orderRef, 'Cancelled', 'Customer Requested Cancellation');
    assert.equal(outcome.changed, false);
    assert.deepEqual(db.writes, [], 'an existing cancellation reason is never overwritten');

    const db2 = fakeDb({ status: 'Cancelled' });
    const outcome2 = await applyOrderStatus(db2, orderRef, 'Cancelled', 'Item Out of Stock');
    assert.deepEqual(outcome2, { changed: true, previousStatus: 'Cancelled' });
    assert.deepEqual(db2.writes, [{ status: 'Cancelled', cancellationReason: 'Item Out of Stock' }]);
  });

  test('rejects transitions the status machine does not allow', async () => {
    const db = fakeDb({ status: 'Cancelled' });
    await assert.rejects(
      applyOrderStatus(db, orderRef, 'Preparing', ''),
      (err) => err.code === 'failed-precondition',
    );
    assert.deepEqual(db.writes, []);
  });

  test('reports a missing order as not-found', async () => {
    const db = fakeDb(undefined);
    await assert.rejects(applyOrderStatus(db, orderRef, 'Preparing', ''), (err) => err.code === 'not-found');
    assert.deepEqual(db.writes, []);
  });
});
