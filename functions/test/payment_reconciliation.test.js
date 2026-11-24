const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  resolveOrderDocId,
  verifyPaymongoSignature,
  extractPaymongoWebhookEvent,
} = require('../lib/payments/webhook');
const {
  hasPaidPayment,
  hasPaidPaymentForAmount,
  paidPaymentAmountCentavos,
  hasFailedPayment,
  firstPaymentId,
  fetchCheckoutSessionDetailed,
  formatPaymentConfirmedMessage,
  markOrderPaidOnce,
  markOrderPaymentFailed,
} = require('../lib/payments/paymongo');
const { hasMatchingCheckoutSession } = require('../lib/payments/verify_payment');
const { isLiveCheckoutSession, shouldMarkPaymentFailed } = require('../lib/payments/paymongo');
const { isOrderVisibleInKds, toIsoTimestamp, clampOrdersLimit, isAllowedStatusTransition } = require('../lib/orders/kds');
const { kdsMirrorDoc, shouldNotifyKitchen } = require('../lib/orders/derived');
const {
  idempotentOrderDocId,
  orderPayloadFingerprint,
  legacyOrderPayloadFingerprint,
  matchesIdempotencyHash,
} = require('../lib/orders/place_order');
const { clientIpFromRequest } = require('../lib/util/security');
const { isCountableOrder } = require('../lib/util');
const { safeDateLabel } = require('../lib/reporting/daily_stats');
const { validateAndPriceItems } = require('../lib/payments/create_checkout');

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

test('verifyPaymongoSignature validates HMAC-SHA256 and timestamp replay window when secret is set', () => {
  const secret = 'whsec_test_123';
  const rawBody = JSON.stringify({ data: { id: 'cs_1' } });
  const t = '1700000000';
  const nowSec = 1700000050;
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${sig}`, rawBody, secret, nowSec), true);
  assert.strictEqual(verifyPaymongoSignature(`t=${t},li=${'0'.repeat(64)},te=${sig}`, rawBody, secret, nowSec), true, 'matches valid te when both li and te are present');
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${sig}`, rawBody, secret, 1700000400), false, 'stale timestamp rejected');
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${sig}`, rawBody, secret, 1699999600), false, 'future timestamp rejected');
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${'0'.repeat(64)}`, rawBody, secret, nowSec), false);
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=${'z'.repeat(64)}`, rawBody, secret, nowSec), false);
  assert.strictEqual(verifyPaymongoSignature(`t=${t},te=short`, rawBody, secret, nowSec), false);
  assert.strictEqual(verifyPaymongoSignature(undefined, rawBody, secret, nowSec), false);
});

test('validateAndPriceItems enforces server prices and rejects tampered totals/variants', () => {
  const { validateAndPriceItems } = require('../lib/payments/create_checkout');
  const ok = validateAndPriceItems([
    { name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 2 },
    { name: 'Burger Patty', variant: '', price: 55, quantity: 1 },
  ]);
  assert.strictEqual(ok.total, 175);
  assert.strictEqual(ok.items[0].total, 120);
  assert.throws(() => validateAndPriceItems([{ name: 'Shawarma Wrap', variant: 'Buy 1 Take 1', price: 60, quantity: 1 }]), /Price mismatch/);
  assert.throws(() => validateAndPriceItems([{ name: 'Fake Item', variant: '', price: 1, quantity: 1 }]), /Unknown item/);
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

// The kiosk can replace a checkout session (expired card dialog, back button,
// a second GCash attempt). A failure event for the replaced session then
// arrives after the new one was handed out, and must not fail the live order.
test('a superseded checkout session cannot fail the live one', () => {
  const order = {
    checkoutSessionId: 'cs_live_2',
    checkoutSessionIds: ['cs_old_1', 'cs_live_2'],
    paymentStatus: 'AWAITING_PAYMENT',
  };
  assert.strictEqual(isLiveCheckoutSession(order, 'cs_live_2'), true);
  assert.strictEqual(isLiveCheckoutSession(order, 'cs_old_1'), false);
  assert.strictEqual(shouldMarkPaymentFailed(order, 'cs_live_2'), true);
  assert.strictEqual(shouldMarkPaymentFailed(order, 'cs_old_1'), false);
});

// Orders written before checkoutSessionId existed only carry the history, so
// the newest attempt cannot be told apart from an older one; any bound session
// still counts, and an unbound one still does not.
test('legacy orders fall back to the session history', () => {
  const legacy = { checkoutSessionIds: ['cs_legacy_1'], paymentStatus: 'AWAITING_PAYMENT' };
  assert.strictEqual(isLiveCheckoutSession(legacy, 'cs_legacy_1'), true);
  assert.strictEqual(isLiveCheckoutSession(legacy, 'cs_other'), false);
  assert.strictEqual(isLiveCheckoutSession({}, 'cs_any'), false);
  assert.strictEqual(isLiveCheckoutSession(undefined, 'cs_any'), false);
  assert.strictEqual(isLiveCheckoutSession(legacy, ''), false);
});

// A terminal payment outcome is final: a redelivered or late failure event must
// not overwrite a paid order, nor re-open one the expiry sweep already closed.
test('terminal payment statuses are never rewritten as failed', () => {
  const live = 'cs_live';
  for (const paymentStatus of ['PAID', 'PAYMENT_EXPIRED']) {
    const order = { checkoutSessionId: live, paymentStatus };
    assert.strictEqual(shouldMarkPaymentFailed(order, live), false, paymentStatus);
  }
  assert.strictEqual(shouldMarkPaymentFailed({ checkoutSessionId: live, paymentStatus: 'PAYMENT_FAILED' }, live), true);
});

// Both callers pass the session id they validated from the provider payload, so
// a future caller that forgets it must fail closed rather than accept any
// failure event for the order.
test('a failure event with no session id fails closed', () => {
  assert.strictEqual(shouldMarkPaymentFailed({ paymentStatus: 'AWAITING_PAYMENT' }, ''), false);
  assert.strictEqual(shouldMarkPaymentFailed({ paymentStatus: 'PAID' }, ''), false);
  assert.strictEqual(shouldMarkPaymentFailed(undefined, 'cs_live'), false);
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

test('clampOrdersLimit bounds caller limits to [1, 200] with default 200', () => {
  assert.strictEqual(clampOrdersLimit(undefined), 200);
  assert.strictEqual(clampOrdersLimit(0), 200);
  assert.strictEqual(clampOrdersLimit(-5), 200);
  assert.strictEqual(clampOrdersLimit(1.5), 200);
  assert.strictEqual(clampOrdersLimit('abc'), 200);
  assert.strictEqual(clampOrdersLimit(50), 50);
  assert.strictEqual(clampOrdersLimit(500), 200);
});

test('hasPaidPaymentForAmount rejects partial or missing payment amounts', () => {
  const paid500 = [{ id: 'pay_1', attributes: { status: 'paid', amount: 50000 } }];
  assert.strictEqual(paidPaymentAmountCentavos(paid500), 50000);
  assert.strictEqual(hasPaidPaymentForAmount(paid500, 500), true);
  assert.strictEqual(hasPaidPaymentForAmount(paid500, 501), false);
  assert.strictEqual(hasPaidPaymentForAmount([{ id: 'pay_2', attributes: { status: 'paid', amount: 2000 } }], 500), false);
  assert.strictEqual(hasPaidPaymentForAmount([{ id: 'pay_3', attributes: { status: 'paid' } }], 500), false);
});

test('verifyPaymongoSignature fails closed when the HMAC secret is unset', () => {
  const nowSec = 1700000050;
  assert.strictEqual(verifyPaymongoSignature('not-a-valid-header', '{}', undefined, nowSec), false);
  assert.strictEqual(verifyPaymongoSignature(`t=1700000000,li=${'a'.repeat(64)}`, '{}', undefined, nowSec), false);
  assert.strictEqual(verifyPaymongoSignature(`t=1700000000,li=${'a'.repeat(64)}`, '{}', undefined, 1700000500), false);
});

test('shouldNotifyKitchen holds unpaid GCash orders and skips cancelled orders', () => {
  assert.strictEqual(shouldNotifyKitchen(undefined, { paymentMethod: 'Cash', paymentStatus: 'NOT PAID' }), true);
  assert.strictEqual(shouldNotifyKitchen(undefined, { paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' }), false);
  assert.strictEqual(
    shouldNotifyKitchen(
      { paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' },
      { paymentMethod: 'GCash', paymentStatus: 'PAID' },
    ),
    true,
  );
  assert.strictEqual(
    shouldNotifyKitchen(
      { paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT', status: 'Cancelled' },
      { paymentMethod: 'GCash', paymentStatus: 'PAID', status: 'Cancelled' },
    ),
    false,
  );
  assert.strictEqual(
    shouldNotifyKitchen(
      { paymentMethod: 'GCash', paymentStatus: 'PAID' },
      { paymentMethod: 'GCash', paymentStatus: 'PAID', status: 'Preparing' },
    ),
    false,
  );
});

test('validateAndPriceItems rejects downgraded prices on single-price coolers', () => {
  assert.throws(
    () => validateAndPriceItems([{ name: 'Leche Flan', variant: '', price: 20, quantity: 1 }]),
    /Price mismatch/,
  );
  assert.strictEqual(
    validateAndPriceItems([{ name: 'Leche Flan', variant: '', price: 39, quantity: 1 }]).total,
    39,
  );
  assert.strictEqual(
    validateAndPriceItems([{ name: 'Luna Leche Flan', variant: '', price: 20, quantity: 1 }]).total,
    20,
  );
});

test('idempotentOrderDocId produces stable alphanumeric Firestore doc IDs', () => {
  const a = idempotentOrderDocId('key-abc-12345678');
  const b = idempotentOrderDocId('key-abc-12345678');
  const c = idempotentOrderDocId('key-xyz-87654321');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.match(a, /^[A-Za-z0-9]{1,64}$/);
});

test('validateAndPriceItems rejects prototype keys cleanly with invalid-argument', () => {
  assert.throws(
    () => validateAndPriceItems([{ name: 'toString', price: 0, quantity: 1 }]),
    (err) => err && err.code === 'invalid-argument',
  );
  assert.throws(
    () => validateAndPriceItems([{ name: 'constructor', price: 0, quantity: 1 }]),
    (err) => err && err.code === 'invalid-argument',
  );
});

test('hasMatchingCheckoutSession reconciles both primary and historical checkoutSessionIds', () => {
  const order = { checkoutSessionId: 'cs_latest', checkoutSessionIds: ['cs_first', 'cs_latest'] };
  assert.strictEqual(hasMatchingCheckoutSession(order, 'cs_latest'), true);
  assert.strictEqual(hasMatchingCheckoutSession(order, 'cs_first'), true);
  assert.strictEqual(hasMatchingCheckoutSession(order, 'cs_other'), false);
});

test('hasMatchingCheckoutSession never evicts the original session a customer may pay on', () => {
  // After enough retries the bounded recent-session list rotates the first
  // session out; paying that original URL must still mark the order PAID.
  const rotated = {
    checkoutSessionId: 'cs_sixth',
    checkoutSessionIds: ['cs_second', 'cs_third', 'cs_fourth', 'cs_fifth', 'cs_sixth'],
    initialCheckoutSessionId: 'cs_first',
  };
  assert.strictEqual(hasMatchingCheckoutSession(rotated, 'cs_first'), true);
  assert.strictEqual(hasMatchingCheckoutSession(rotated, 'cs_sixth'), true);
  assert.strictEqual(hasMatchingCheckoutSession(rotated, 'cs_foreign'), false);
});

test('fetchCheckoutSessionDetailed distinguishes 404 from transient 5xx errors', async () => {
  const origFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const notFound = await fetchCheckoutSessionDetailed('cs_missing', 'auth');
    assert.strictEqual(notFound.status, 'not_found');

    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const transient = await fetchCheckoutSessionDetailed('cs_err', 'auth');
    assert.strictEqual(transient.status, 'transient_error');
  } finally {
    global.fetch = origFetch;
  }
});

test('isAllowedStatusTransition blocks illegal terminal transitions', () => {
  assert.strictEqual(isAllowedStatusTransition('Pending', 'Preparing'), true);
  assert.strictEqual(isAllowedStatusTransition('Preparing', 'Ready'), true);
  assert.strictEqual(isAllowedStatusTransition('Ready', 'Completed'), true);
  assert.strictEqual(isAllowedStatusTransition('Pending', 'Cancelled'), true);
  assert.strictEqual(isAllowedStatusTransition('Cancelled', 'Pending'), false);
  assert.strictEqual(isAllowedStatusTransition('Completed', 'Cancelled'), false);
  assert.strictEqual(isAllowedStatusTransition('Completed', 'Completed'), true);
  assert.strictEqual(isAllowedStatusTransition('Cancelled', 'Cancelled'), true);
});

test('safeDateLabel rejects slash/malformed dateLabels to avoid Firestore path errors', () => {
  assert.strictEqual(safeDateLabel('2026-11-21'), '2026-11-21');
  assert.strictEqual(safeDateLabel('2026/11/21'), 'unknown');
  assert.strictEqual(safeDateLabel('../bad'), 'unknown');
  assert.strictEqual(safeDateLabel(undefined), 'unknown');
});

test('extractPaymongoWebhookEvent parses real JSON:API envelope and legacy flat shape', () => {
  assert.deepStrictEqual(
    extractPaymongoWebhookEvent({
      data: {
        id: 'evt_123',
        type: 'event',
        attributes: {
          type: 'checkout_session.payment.paid',
          data: { id: 'cs_live_abc123' },
        },
      },
    }),
    { type: 'checkout_session.payment.paid', sessionId: 'cs_live_abc123' },
  );
  assert.deepStrictEqual(
    extractPaymongoWebhookEvent({
      data: {
        type: 'checkout_session.payment.failed',
        data: { id: 'cs_flat_456' },
      },
    }),
    { type: 'checkout_session.payment.failed', sessionId: 'cs_flat_456' },
  );
  assert.strictEqual(extractPaymongoWebhookEvent({ data: { type: 'event' } }), null);
  assert.strictEqual(extractPaymongoWebhookEvent(null), null);
});

test('orderPayloadFingerprint is deterministic and detects payload tampering', () => {
  const base = {
    type: 'Pickup',
    paymentMethod: 'GCash',
    customerName: 'Ana',
    customerPhone: '09171234567',
    customerAddress: 'Pickup',
    items: [{ name: 'Classic Lemonade', variant: '', price: 49, quantity: 2 }],
  };
  assert.strictEqual(orderPayloadFingerprint(base), orderPayloadFingerprint({ ...base }));
  assert.notStrictEqual(
    orderPayloadFingerprint(base),
    orderPayloadFingerprint({ ...base, customerName: 'Mallory' }),
  );
  assert.notStrictEqual(
    orderPayloadFingerprint(base),
    orderPayloadFingerprint({ ...base, paymentMethod: 'Cash' }),
  );
  assert.notStrictEqual(
    orderPayloadFingerprint({ ...base, type: 'Delivery', lat: 9.02, lng: 125.51 }),
    orderPayloadFingerprint({ ...base, type: 'Delivery', lat: 9.03, lng: 125.52 }),
  );
  assert.notStrictEqual(
    orderPayloadFingerprint({ ...base, entryType: 'Kiosk' }),
    orderPayloadFingerprint({ ...base, entryType: 'Staff' }),
  );
  const currentKiosk = orderPayloadFingerprint({ ...base, entryType: 'Kiosk' });
  const legacy = legacyOrderPayloadFingerprint(base);
  assert.strictEqual(
    matchesIdempotencyHash({ idempotencyHash: legacy, entryType: 'Kiosk' }, currentKiosk, legacy, 'Kiosk'),
    true,
  );
  assert.strictEqual(
    matchesIdempotencyHash({ idempotencyHash: legacy, entryType: 'Kiosk' }, currentKiosk, legacy, 'Staff'),
    false,
  );
});

test('clientIpFromRequest uses rightmost x-forwarded-for hop and falls back to rawRequest.ip', () => {
  assert.strictEqual(clientIpFromRequest({ ip: '1.2.3.4' }), '1.2.3.4');
  assert.strictEqual(
    clientIpFromRequest({ ip: '1.1.1.1', headers: { 'x-forwarded-for': 'spoofed.1.2.3, 203.0.113.9' } }),
    '203.0.113.9',
  );
  assert.strictEqual(clientIpFromRequest({}), '');
});

test('isOrderVisibleInKds and isCountableOrder require PAID allowlist for GCash', () => {
  assert.strictEqual(isOrderVisibleInKds({ paymentMethod: 'gcash', paymentStatus: 'AWAITING_PAYMENT' }), false);
  assert.strictEqual(isOrderVisibleInKds({ paymentMethod: 'GCash', paymentStatus: 'NOT PAID' }), false);
  assert.strictEqual(isOrderVisibleInKds({ paymentMethod: 'gcash', paymentStatus: '' }), false);
  assert.strictEqual(isOrderVisibleInKds({ paymentMethod: 'gcash', paymentStatus: 'PAID' }), true);
  assert.strictEqual(isOrderVisibleInKds({ paymentMethod: 'Cash', paymentStatus: 'NOT PAID' }), true);

  assert.strictEqual(isCountableOrder({ status: 'Pending', paymentMethod: 'GCash', paymentStatus: 'NOT PAID' }), false);
  assert.strictEqual(isCountableOrder({ status: 'Pending', paymentMethod: 'gcash', paymentStatus: 'PAID' }), true);
  assert.strictEqual(isCountableOrder({ status: 'Cancelled', paymentMethod: 'Cash', paymentStatus: 'PAID' }), false);
});

test('formatPaymentConfirmedMessage escapes MarkdownV2 punctuation in cancelled-order refund alerts', () => {
  const cancelledMsg = formatPaymentConfirmedMessage(
    { orderId: 'LU-123', customerName: 'Ana', totalAmount: 99, type: 'Delivery', status: 'Cancelled' },
    'LU-123',
    '11/21/2026, 5:00:00 PM',
  );
  assert.match(cancelledMsg, /PAYMENT RECEIVED FOR CANCELLED ORDER/);
  assert.match(cancelledMsg, /review for refund\\\./);
  assert.ok(!/(?<!\\)\./.test(cancelledMsg), 'no unescaped MarkdownV2 period');

  const normalMsg = formatPaymentConfirmedMessage(
    { orderId: 'LU-124', customerName: 'Ana', totalAmount: 99, type: 'Pickup', status: 'Pending' },
    'LU-124',
    '11/21/2026, 5:00:00 PM',
  );
  assert.match(normalMsg, /PAYMENT CONFIRMED/);
});

test('fetchCheckoutSessionDetailed URL-encodes sessionId in request path', async () => {
  const origFetch = global.fetch;
  let capturedUrl = '';
  try {
    global.fetch = async (url) => {
      capturedUrl = String(url);
      return { ok: false, status: 404, json: async () => ({}) };
    };
    await fetchCheckoutSessionDetailed('cs_test/../evil', 'auth');
    assert.strictEqual(
      capturedUrl,
      'https://api.paymongo.com/v2/checkout_sessions/cs_test%2F..%2Fevil',
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('markOrderPaidOnce and markOrderPaymentFailed stay truthful across Firestore transaction contention retries', async () => {
  const firestoreMod = require('firebase-admin/firestore');
  const origGetFirestore = firestoreMod.getFirestore;
  try {
    const snapshots = [
      { exists: true, data: () => ({ paymentStatus: 'AWAITING_PAYMENT', checkoutSessionId: 'cs_live', totalAmount: 100 }) },
      { exists: true, data: () => ({ paymentStatus: 'PAID', checkoutSessionId: 'cs_live', totalAmount: 100 }) },
    ];
    let attempt = 0;
    firestoreMod.getFirestore = () => ({
      async runTransaction(fn) {
        let lastResult;
        while (attempt < snapshots.length) {
          const snap = snapshots[attempt++];
          lastResult = await fn({
            get: async () => snap,
            set() {},
            update() {},
          });
        }
        return lastResult;
      },
    });

    const paidResult = await markOrderPaidOnce({ id: 'ord_1' }, 'pay_1', '', 'cs_live', 10000);
    assert.deepStrictEqual(paidResult, { transitioned: false, alreadyPaid: true });

    attempt = 0;
    const failedResult = await markOrderPaymentFailed({ id: 'ord_1' }, 'cs_live');
    assert.deepStrictEqual(failedResult, { updated: false, paymentStatus: 'PAID' });
  } finally {
    firestoreMod.getFirestore = origGetFirestore;
  }
});

test('a verified payment for a missing order is refused out loud, not silently', async () => {
  const firestoreMod = require('firebase-admin/firestore');
  const ff = require('firebase-functions');
  const origGetFirestore = firestoreMod.getFirestore;
  const origWarn = ff.logger.warn;
  const warnings = [];
  ff.logger.warn = (...args) => warnings.push(args.join(' '));
  try {
    firestoreMod.getFirestore = () => ({
      runTransaction: (fn) => fn({ get: async () => ({ exists: false }), set() {}, update() {} }),
    });

    const result = await markOrderPaidOnce({ id: 'ord_ghost' }, 'pay_1', '', 'cs_live', 5000);

    assert.deepStrictEqual(result, { transitioned: false, alreadyPaid: false });
    assert.equal(warnings.length, 1, 'the rejection is reported once');
    assert.match(warnings[0], /Refusing to mark order ord_ghost PAID: order document does not exist/);
  } finally {
    firestoreMod.getFirestore = origGetFirestore;
    ff.logger.warn = origWarn;
  }
});

test('persistCheckoutSession returns the winning attempt session after a transaction contention retry', async () => {
  const { persistCheckoutSession } = require('../lib/payments/create_checkout');
  const nowMs = 1_700_000_000_000;
  const snapshots = [
    {
      exists: true,
      data: () => ({
        paymentMethod: 'GCash',
        status: 'Pending',
        paymentStatus: 'AWAITING_PAYMENT',
        checkoutSessionId: 'cs_old',
        checkoutUrl: 'https://checkout.paymongo.com/cs_old',
        checkoutCreatedAt: nowMs - 10_000,
      }),
    },
    {
      exists: true,
      data: () => ({
        paymentMethod: 'GCash',
        status: 'Pending',
        paymentStatus: 'PAYMENT_FAILED',
        checkoutSessionId: 'cs_old',
        checkoutUrl: 'https://checkout.paymongo.com/cs_old',
        checkoutCreatedAt: nowMs - 10_000,
      }),
    },
  ];

  let attempt = 0;
  let lastWritten = null;
  const fakeDb = {
    async runTransaction(fn) {
      let lastResult;
      while (attempt < snapshots.length) {
        const snap = snapshots[attempt++];
        lastResult = await fn({
          get: async () => snap,
          set(_ref, payload) {
            lastWritten = payload;
          },
        });
      }
      return lastResult;
    },
  };

  const result = await persistCheckoutSession(
    fakeDb,
    { id: 'ord_retry' },
    { sessionId: 'cs_new', checkoutUrl: 'https://checkout.paymongo.com/cs_new' },
    150,
    nowMs,
  );

  assert.deepStrictEqual(result, {
    sessionId: 'cs_new',
    checkoutUrl: 'https://checkout.paymongo.com/cs_new',
  });
  assert.strictEqual(lastWritten.checkoutSessionId, 'cs_new');
  assert.strictEqual(lastWritten.checkoutUrl, 'https://checkout.paymongo.com/cs_new');
});

test('paymongoAuthHeader trims secret whitespace and rejects whitespace-only secret', () => {
  const { paymongoAuthHeader } = require('../lib/payments/paymongo');
  const { paymongoSecret } = require('../lib/secrets');
  const orig = paymongoSecret.value;
  try {
    paymongoSecret.value = () => 'sk_test_abc123\n';
    assert.strictEqual(
      paymongoAuthHeader(true),
      Buffer.from('sk_test_abc123:').toString('base64'),
    );
    paymongoSecret.value = () => '   \n';
    assert.throws(() => paymongoAuthHeader(true), /Payment service not configured/);
  } finally {
    paymongoSecret.value = orig;
  }
});

test('getMapTilerStaticMapUrl trims and URL-encodes the API key', () => {
  const { getMapTilerStaticMapUrl } = require('../lib/orders/send_notification');
  const url = getMapTilerStaticMapUrl(9.02, 125.51, 'key+with spaces\n');
  assert.ok(url.includes('key=key%2Bwith%20spaces&'), `unexpected url: ${url}`);
});

test('assertOrderCheckoutEligible and persistCheckoutSession reject Completed and PAYMENT_EXPIRED orders', async () => {
  const { assertOrderCheckoutEligible, persistCheckoutSession } = require('../lib/payments/create_checkout');

  assert.doesNotThrow(() =>
    assertOrderCheckoutEligible({ paymentMethod: 'GCash', status: 'Pending', paymentStatus: 'AWAITING_PAYMENT' }),
  );
  assert.doesNotThrow(() =>
    assertOrderCheckoutEligible({ paymentMethod: 'GCash', status: 'Pending', paymentStatus: 'PAYMENT_FAILED' }),
  );
  assert.throws(
    () => assertOrderCheckoutEligible({ paymentMethod: 'GCash', status: 'Completed', paymentStatus: 'AWAITING_PAYMENT' }),
    /Order is already completed/,
  );
  assert.throws(
    () => assertOrderCheckoutEligible({ paymentMethod: 'GCash', status: 'Pending', paymentStatus: 'PAYMENT_EXPIRED' }),
    /Order payment session has expired/,
  );

  for (const [label, orderData, pattern] of [
    ['PAYMENT_EXPIRED', { paymentMethod: 'GCash', status: 'Pending', paymentStatus: 'PAYMENT_EXPIRED' }, /Order payment session has expired/],
    ['Completed', { paymentMethod: 'GCash', status: 'Completed', paymentStatus: 'AWAITING_PAYMENT' }, /Order is already completed/],
    ['Cancelled', { paymentMethod: 'GCash', status: 'Cancelled', paymentStatus: 'AWAITING_PAYMENT' }, /Order is cancelled/],
  ]) {
    let wrote = false;
    const fakeDb = {
      async runTransaction(fn) {
        return fn({
          get: async () => ({
            exists: true,
            data: () => orderData,
          }),
          set() {
            wrote = true;
          },
        });
      },
    };
    await assert.rejects(
      persistCheckoutSession(
        fakeDb,
        { id: `ord_${label}` },
        { sessionId: 'cs_new', checkoutUrl: 'https://checkout.paymongo.com/cs_new' },
        150,
      ),
      pattern,
    );
    assert.strictEqual(wrote, false, `persistCheckoutSession should not write for ${label}`);
  }
});

test('paymongoWebhook rejects invalid signatures before touching Firestore rate limits', async () => {
  const { paymongoWebhook } = require('../lib/payments/webhook');
  const { paymongoWebhookSecret } = require('../lib/secrets');
  const origSecret = paymongoWebhookSecret.value;
  let statusCode = null;
  let body = null;
  const req = {
    method: 'POST',
    headers: { 'paymongo-signature': 't=1700000000,li=0000000000000000000000000000000000000000000000000000000000000000' },
    rawBody: Buffer.from('{}'),
    body: {},
    ip: '203.0.113.10',
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    send(msg) {
      body = msg;
      return this;
    },
  };
  try {
    paymongoWebhookSecret.value = () => 'whsec_test_secret';
    await paymongoWebhook(req, res);
    assert.strictEqual(statusCode, 401);
    assert.strictEqual(body, 'Invalid signature');
  } finally {
    paymongoWebhookSecret.value = origSecret;
  }
});

test('paidPaymentAmountCentavos accepts PHP or omitted currency and rejects non-PHP currencies', () => {
  assert.strictEqual(
    paidPaymentAmountCentavos([{ id: 'p1', attributes: { status: 'paid', amount: 15000, currency: 'PHP' } }]),
    15000,
  );
  assert.strictEqual(
    paidPaymentAmountCentavos([{ id: 'p2', attributes: { status: 'paid', amount: 15000, currency: ' php ' } }]),
    15000,
  );
  assert.strictEqual(
    paidPaymentAmountCentavos([{ id: 'p3', attributes: { status: 'paid', amount: 15000 } }]),
    15000,
  );
  assert.strictEqual(
    paidPaymentAmountCentavos([{ id: 'p3b', attributes: { status: 'paid', amount: 15000, currency: '' } }]),
    15000,
  );
  assert.strictEqual(
    paidPaymentAmountCentavos([{ id: 'p3c', attributes: { status: 'paid', amount: 15000, currency: '   ' } }]),
    15000,
  );
  assert.strictEqual(
    paidPaymentAmountCentavos([{ id: 'p4', attributes: { status: 'paid', amount: 15000, currency: 'USD' } }]),
    null,
  );
  assert.strictEqual(
    hasPaidPaymentForAmount([{ id: 'p5', attributes: { status: 'paid', amount: 15000, currency: 'USD' } }], 150),
    false,
  );
});

test('projectOrder and projectOrderSummary clamp non-finite/negative numbers and invalid coordinates', () => {
  const { projectOrder, projectOrderSummary } = require('../lib/orders/kds');
  const raw = {
    orderId: 'LU-261124-0001',
    lat: 95,
    lng: Number.POSITIVE_INFINITY,
    deliveryFee: -25,
    totalAmount: Number.POSITIVE_INFINITY,
    paymentMethod: 'Cash',
    status: 'Pending',
    items: [null, { name: 'Wrap', quantity: -2, qty: 3, price: -10 }, { name: 'Tea', quantity: Number.NaN, price: Number.POSITIVE_INFINITY }],
  };
  const full = projectOrder('doc_bad', raw);
  assert.strictEqual(full.lat, null);
  assert.strictEqual(full.lng, null);
  assert.strictEqual(full.deliveryFee, 0);
  assert.strictEqual(full.total, 0);
  assert.strictEqual(full.itemsCount, 3);
  assert.strictEqual(full.items[0].name, '');
  assert.strictEqual(full.items[1].qty, 3);
  assert.strictEqual(full.items[1].price, 0);
  assert.strictEqual(full.items[2].price, 0);

  const summary = projectOrderSummary('doc_bad', raw);
  assert.strictEqual(summary.total, 0);
  assert.strictEqual(summary.itemsCount, 3);
});

test('markOrderPaidOnce atomically mirrors a paid GCash order to kds_orders in the same transaction', async () => {
  const firestoreMod = require('firebase-admin/firestore');
  const origGetFirestore = firestoreMod.getFirestore;
  const txSets = [];
  try {
    firestoreMod.getFirestore = () => ({
      collection(name) {
        return {
          doc(id) {
            return { path: `${name}/${id}`, id };
          },
        };
      },
      async runTransaction(fn) {
        return fn({
          async get() {
            return {
              exists: true,
              data: () => ({
                orderId: 'LU-GCASH-PAID',
                customerName: 'Ben',
                paymentMethod: 'GCash',
                paymentStatus: 'AWAITING_PAYMENT',
                checkoutSessionId: 'cs_live',
                totalAmount: 150,
                status: 'Pending',
                type: 'Delivery',
                items: [{ name: 'Shawarma Wrap', variant: 'Solo', quantity: 2, price: 75 }],
                timestamp: '2026-11-24T12:00:00.000Z',
              }),
            };
          },
          set(ref, doc, opts) {
            txSets.push({ ref, doc, opts });
          },
        });
      },
    });

    const result = await markOrderPaidOnce({ id: 'ord_gcash_1' }, 'pay_live_1', '', 'cs_live', 15000);
    assert.deepStrictEqual(result, { transitioned: true, alreadyPaid: false });
    assert.strictEqual(txSets.length, 2);
    assert.strictEqual(txSets[1].ref.path, 'kds_orders/ord_gcash_1');
    assert.strictEqual(txSets[1].doc.paymentStatus, 'PAID');
    assert.strictEqual(txSets[1].doc.orderNumber, 'LU-GCASH-PAID');
    assert.strictEqual(txSets[1].doc.paymongoPaymentId, undefined, 'mirror never leaks payment ids');
    assert.strictEqual(typeof txSets[1].doc.sourceEventMs, 'number');
    assert.ok(txSets[1].doc.expireAt);
  } finally {
    firestoreMod.getFirestore = origGetFirestore;
  }
});
