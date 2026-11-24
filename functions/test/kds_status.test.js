// The kitchen board must answer for the document its transaction actually
// read: a duplicate tap on a status column is not a status change, and a
// response that claims otherwise makes the tablet resync against a stale view.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { applyOrderStatus, pageSizeForActiveOrders, MAX_SCAN_DOCS, buildKdsMirrorWrite } = require('../lib/orders/kds');
const { isKdsMirrorUnchanged, kdsMirrorDoc } = require('../lib/orders/derived');

function fakeDb(current) {
  const writes = [];
  const sets = [];
  return {
    writes,
    sets,
    async runTransaction(fn) {
      return fn({
        async get() {
          return { exists: current !== undefined, data: () => current };
        },
        update(_ref, patch) {
          writes.push(patch);
        },
        set(ref, doc) {
          sets.push({ ref, doc });
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

  test('atomically mirrors visible order status updates to kds_orders when mirrorRef is passed', async () => {
    const mirrorRef = { id: 'ord1', path: 'kds_orders/ord1' };
    const db = fakeDb({
      orderId: 'LU-100',
      customerName: 'Ana',
      paymentMethod: 'Cash',
      paymentStatus: 'NOT PAID',
      status: 'Pending',
      totalAmount: 99,
      items: [{ name: 'Shawarma Wrap', variant: 'Solo', quantity: 1, price: 60 }],
      timestamp: '2026-11-24T10:00:00.000Z',
    });
    const outcome = await applyOrderStatus(db, orderRef, 'Preparing', '', mirrorRef);
    assert.deepEqual(outcome, { changed: true, previousStatus: 'Pending' });
    assert.equal(db.sets.length, 1);
    assert.strictEqual(db.sets[0].ref, mirrorRef);
    assert.equal(db.sets[0].doc.status, 'Preparing');
    assert.equal(db.sets[0].doc.orderNumber, 'LU-100');
    assert.equal(typeof db.sets[0].doc.sourceEventMs, 'number');
    assert.ok(db.sets[0].doc.expireAt);
  });

  test('skips kds_orders mirror write for unpaid GCash orders', async () => {
    const mirrorRef = { id: 'ord_gcash', path: 'kds_orders/ord_gcash' };
    const db = fakeDb({
      orderId: 'LU-GCASH',
      paymentMethod: 'GCash',
      paymentStatus: 'AWAITING_PAYMENT',
      status: 'Pending',
    });
    const outcome = await applyOrderStatus(db, orderRef, 'Cancelled', 'Duplicate / Test Order', mirrorRef);
    assert.deepEqual(outcome, { changed: true, previousStatus: 'Pending' });
    assert.equal(db.sets.length, 0);
  });
});

describe('pageSizeForActiveOrders', () => {
  test('trims over-fetching for small includeCompleted dashboard queries', () => {
    assert.equal(pageSizeForActiveOrders(10, true, MAX_SCAN_DOCS), 20);
    assert.equal(pageSizeForActiveOrders(50, true, MAX_SCAN_DOCS), 60);
    assert.equal(pageSizeForActiveOrders(200, true, MAX_SCAN_DOCS), 200);
  });

  test('keeps a larger buffer for active-only KDS queries and clamps to remaining scan budget', () => {
    assert.equal(pageSizeForActiveOrders(10, false, MAX_SCAN_DOCS), 50);
    assert.equal(pageSizeForActiveOrders(200, false, 35), 35);
    assert.equal(pageSizeForActiveOrders(10, true, 5), 5);
  });
});

describe('isKdsMirrorUnchanged', () => {
  const sampleOrder = {
    orderId: 'LU-200',
    customerName: 'Ana',
    paymentMethod: 'Cash',
    paymentStatus: 'NOT PAID',
    status: 'Pending',
    totalAmount: 99,
    items: [{ name: 'Shawarma Wrap', variant: 'Solo', quantity: 1, price: 60 }],
    timestamp: '2026-11-24T10:00:00.000Z',
  };

  test('returns true when mirror fields match regardless of key order or metadata', () => {
    const written = buildKdsMirrorWrite('ord200', sampleOrder, 1700000000000);
    const reordered = {};
    for (const key of Object.keys(written).sort()) {
      reordered[key] = written[key];
    }
    const next = kdsMirrorDoc('ord200', sampleOrder);
    assert.equal(isKdsMirrorUnchanged(reordered, next), true);
  });

  test('returns false when expireAt is missing or order fields changed', () => {
    const written = buildKdsMirrorWrite('ord200', sampleOrder, 1700000000000);
    const next = kdsMirrorDoc('ord200', sampleOrder);

    const noExpire = { ...written };
    delete noExpire.expireAt;
    assert.equal(isKdsMirrorUnchanged(noExpire, next), false);

    const updatedNext = kdsMirrorDoc('ord200', { ...sampleOrder, status: 'Preparing' });
    assert.equal(isKdsMirrorUnchanged(written, updatedNext), false);
  });
});
