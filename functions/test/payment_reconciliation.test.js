const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { resolveOrderDocId, verifyPaymongoSignature } = require('../lib/payments/webhook');
const { hasPaidPayment, hasFailedPayment, firstPaymentId } = require('../lib/payments/paymongo');
const { hasMatchingCheckoutSession } = require('../lib/payments/verify_payment');
const { isOrderVisibleInKds, toIsoTimestamp } = require('../lib/orders/kds');
const { kdsMirrorDoc } = require('../lib/orders/derived');

// A paid session must land on the order document the kiosk wrote. PayMongo
// echoes our metadata back on the webhook, so the document id travels there
// while reference_number stays the human-facing order number.
test('prefers the order document id from metadata', () => {
  assert.strictEqual(
    resolveOrderDocId({
      reference_number: 'LU-260102-030405',
      metadata: { order_doc_id: 'aB3xY9zKq1LmN2pQr4St' },
    }),
    'aB3xY9zKq1LmN2pQr4St',
  );
});

test('falls back to reference_number for sessions created before this change', () => {
  assert.strictEqual(
    resolveOrderDocId({ reference_number: 'LU-48213' }),
    'LU-48213',
  );
});

test('ignores metadata that is not a plain document id', () => {
  assert.strictEqual(
    resolveOrderDocId({
      reference_number: 'LU-48213',
      metadata: { order_doc_id: 'orders/../../admin' },
    }),
    'LU-48213',
  );
});

test('returns null when the payload has no usable id', () => {
  assert.strictEqual(resolveOrderDocId({}), null);
  assert.strictEqual(resolveOrderDocId(null), null);
  assert.strictEqual(resolveOrderDocId({ reference_number: 42 }), null);
  assert.strictEqual(
    resolveOrderDocId({ metadata: { order_doc_id: 'has spaces' } }),
    null,
  );
});

test('verifyPaymongoSignature validates HMAC-SHA256 when secret is set', () => {
  const secret = 'whsec_test_123';
  const rawBody = JSON.stringify({ data: { id: 'cs_1' } });
  const t = '1700000000';
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${sig}`, rawBody, secret), true);
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${'0'.repeat(64)}`, rawBody, secret), false);
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${'z'.repeat(64)}`, rawBody, secret), false);
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=short`, rawBody, secret), false);
  assert.strictEqual(verifyPaymongoSignature(undefined, rawBody, secret), false);
});

test('PayMongo payment status helpers identify paid vs failed sessions', () => {
  assert.strictEqual(hasPaidPayment([{ id: 'pay_1', attributes: { status: 'paid' } }]), true);
  assert.strictEqual(hasPaidPayment([{ id: 'pay_2', attributes: { status: 'failed' } }]), false);
  assert.strictEqual(hasFailedPayment([{ id: 'pay_2', attributes: { status: 'failed' } }]), true);
  assert.strictEqual(
    hasFailedPayment([
      { id: 'pay_2', attributes: { status: 'failed' } },
      { id: 'pay_3', attributes: { status: 'paid' } },
    ]),
    false,
  );
  assert.strictEqual(
    firstPaymentId([
      { id: 'pay_failed', attributes: { status: 'failed' } },
      { id: 'pay_paid', attributes: { status: 'paid' } },
    ]),
    'pay_paid',
  );
});

test('KDS projection excludes unconfirmed GCash and handles invalid timestamps cleanly', () => {
  assert.strictEqual(
    isOrderVisibleInKds({ paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' }),
    false,
  );
  assert.strictEqual(
    isOrderVisibleInKds({ paymentMethod: 'GCash', paymentStatus: 'PAYMENT_FAILED' }),
    false,
  );
  assert.strictEqual(
    isOrderVisibleInKds({ paymentMethod: 'GCash', paymentStatus: 'PAID' }),
    true,
  );
  assert.strictEqual(
    isOrderVisibleInKds({ paymentMethod: 'Cash', paymentStatus: 'NOT PAID' }),
    true,
  );
  assert.strictEqual(toIsoTimestamp('not-a-date'), '1970-01-01T00:00:00.000Z');
  const mirror = kdsMirrorDoc('ord1', { customerName: 'Test', timestamp: 'invalid-ts' });
  assert.strictEqual(mirror.timestamp, '1970-01-01T00:00:00.000Z');
});

test('hasMatchingCheckoutSession rejects unbound or mismatched orders', () => {
  assert.strictEqual(hasMatchingCheckoutSession({}, 'cs_paid_1'), false);
  assert.strictEqual(hasMatchingCheckoutSession({ checkoutSessionId: '' }, 'cs_paid_1'), false);
  assert.strictEqual(hasMatchingCheckoutSession({ checkoutSessionId: 'cs_other' }, 'cs_paid_1'), false);
  assert.strictEqual(hasMatchingCheckoutSession({ checkoutSessionId: 'cs_paid_1' }, 'cs_paid_1'), true);
});

test('projectOrder projects KDS fields and sums item quantities from quantity or qty', () => {
  const { projectOrder } = require('../lib/orders/kds');
  const projected = projectOrder('doc_1', {
    orderId: 'LU-261116-120000',
    customerName: 'Ana',
    customerPhone: '09171234567',
    customerAddress: 'Purok 5',
    lat: 9.02,
    lng: 125.51,
    deliveryFee: '25',
    paymentMethod: 'GCash',
    paymentStatus: 'PAID',
    entryType: 'Kiosk',
    type: 'Delivery',
    status: 'Preparing',
    totalAmount: 258,
    timestamp: '2026-11-16T04:00:00.000Z',
    items: [
      { name: 'Shawarma Wrap', variant: 'Solo', quantity: 2, price: 60 },
      { name: 'Fries', qty: 3, price: 50 },
    ],
  });
  assert.deepStrictEqual(projected, {
    id: 'doc_1',
    orderNumber: 'LU-261116-120000',
    customerName: 'Ana',
    customerPhone: '09171234567',
    customerAddress: 'Purok 5',
    lat: 9.02,
    lng: 125.51,
    deliveryFee: 25,
    paymentMethod: 'GCash',
    paymentStatus: 'PAID',
    entryType: 'Kiosk',
    items: [
      { name: 'Shawarma Wrap', variant: 'Solo', qty: 2, quantity: 2, price: 60 },
      { name: 'Fries', variant: '', qty: 3, quantity: 3, price: 50 },
    ],
    itemsCount: 5,
    total: 258,
    type: 'Delivery',
    status: 'Preparing',
    timestamp: '2026-11-16T04:00:00.000Z',
  });
});

test('fetchSessionPayments sends Basic auth and handles non-OK responses', async () => {
  const { fetchSessionPayments } = require('../lib/payments/paymongo');
  const origFetch = global.fetch;
  try {
    let seen = null;
    global.fetch = async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ data: { attributes: { payments: [{ id: 'pay_9' }] } } }) };
    };
    const payments = await fetchSessionPayments('cs_123', 'dGVzdDo=');
    assert.strictEqual(seen.url, 'https://api.paymongo.com/v2/checkout_sessions/cs_123');
    assert.strictEqual(seen.init.headers.Authorization, 'Basic dGVzdDo=');
    assert.deepStrictEqual(payments, [{ id: 'pay_9' }]);

    global.fetch = async () => ({ ok: false });
    assert.strictEqual(await fetchSessionPayments('cs_123', 'dGVzdDo='), null);
  } finally {
    global.fetch = origFetch;
  }
});
