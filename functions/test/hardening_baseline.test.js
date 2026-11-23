const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { shouldNotifyPaymentConfirmed } = require('../lib/orders/derived');
const { evaluatePaymentNotificationClaim, TELEGRAM_CLAIM_TTL_MS } = require('../lib/orders/send_notification');
const { canClaimDailyReport } = require('../lib/reporting/daily_report');
const { isStaleUnpaidOrder, expireUnpaidUpdate, STALE_UNPAID_AGE_MS } = require('../lib/orders/expire_unpaid');
const { projectOrderSummary } = require('../lib/orders/kds');
const { clientIpFromRequest } = require('../lib/util/security');

test('shouldNotifyPaymentConfirmed fires once on GCash transition to PAID (including Cancelled)', () => {
  assert.equal(
    shouldNotifyPaymentConfirmed(
      { paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT', status: 'Pending' },
      { paymentMethod: 'GCash', paymentStatus: 'PAID', status: 'Pending' },
    ),
    true,
  );
  assert.equal(
    shouldNotifyPaymentConfirmed(
      { paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT', status: 'Cancelled' },
      { paymentMethod: 'GCash', paymentStatus: 'PAID', status: 'Cancelled', paidAfterCancel: true },
    ),
    true,
  );
  assert.equal(
    shouldNotifyPaymentConfirmed(
      { paymentMethod: 'GCash', paymentStatus: 'PAID', status: 'Pending' },
      { paymentMethod: 'GCash', paymentStatus: 'PAID', status: 'Preparing' },
    ),
    false,
  );
  assert.equal(
    shouldNotifyPaymentConfirmed(
      { paymentMethod: 'Cash', paymentStatus: 'NOT PAID', status: 'Pending' },
      { paymentMethod: 'Cash', paymentStatus: 'PAID', status: 'Pending' },
    ),
    false,
  );
  assert.equal(
    shouldNotifyPaymentConfirmed(
      { paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT', status: 'Pending' },
      { paymentMethod: 'GCash', paymentStatus: 'PAYMENT_FAILED', status: 'Pending' },
    ),
    false,
  );
});

test('evaluatePaymentNotificationClaim deduplicates sent and in-flight alerts', () => {
  const now = 1_700_000_000_000;
  assert.equal(evaluatePaymentNotificationClaim(undefined, now), 'missing');
  assert.equal(evaluatePaymentNotificationClaim({}, now), 'claimed');
  assert.equal(evaluatePaymentNotificationClaim({ paymentNotifSent: true }, now), 'already-sent');
  assert.equal(
    evaluatePaymentNotificationClaim({ paymentNotifStatus: 'sending', paymentNotifClaimedAt: now - 5_000 }, now),
    'in-flight',
  );
  assert.equal(
    evaluatePaymentNotificationClaim(
      { paymentNotifStatus: 'sending', paymentNotifClaimedAt: now - TELEGRAM_CLAIM_TTL_MS - 1 },
      now,
    ),
    'claimed',
  );
  assert.equal(
    evaluatePaymentNotificationClaim({ paymentNotifStatus: 'failed', paymentNotifSent: false }, now),
    'claimed',
  );
});

test('canClaimDailyReport blocks duplicate sends and active claims', () => {
  const now = 1_700_000_000_000;
  assert.equal(canClaimDailyReport(undefined, now), true);
  assert.equal(canClaimDailyReport({ status: 'sent' }, now), false);
  assert.equal(canClaimDailyReport({ status: 'sending', claimedAt: now - 30_000 }, now), false);
  assert.equal(canClaimDailyReport({ status: 'sending', claimedAt: now - 10 * 60_000 }, now), true);
  assert.equal(canClaimDailyReport({ status: 'failed' }, now), true);
});

test('isStaleUnpaidOrder matches only AWAITING_PAYMENT orders at least 24h old', () => {
  const now = Date.parse('2026-11-22T12:00:00.000Z');
  const staleIso = new Date(now - STALE_UNPAID_AGE_MS - 1_000).toISOString();
  const freshIso = new Date(now - STALE_UNPAID_AGE_MS + 60_000).toISOString();

  assert.equal(isStaleUnpaidOrder({ paymentStatus: 'AWAITING_PAYMENT', timestamp: staleIso }, now), true);
  assert.equal(isStaleUnpaidOrder({ paymentStatus: 'AWAITING_PAYMENT', timestamp: freshIso }, now), false);
  assert.equal(isStaleUnpaidOrder({ paymentStatus: 'PAID', timestamp: staleIso }, now), false);
  assert.equal(isStaleUnpaidOrder({ paymentStatus: 'PAYMENT_EXPIRED', timestamp: staleIso }, now), false);
  assert.equal(isStaleUnpaidOrder({ paymentStatus: 'AWAITING_PAYMENT', timestamp: 'invalid' }, now), false);
  assert.equal(isStaleUnpaidOrder(undefined, now), false);

  assert.deepEqual(expireUnpaidUpdate({ status: 'Pending', paymentStatus: 'AWAITING_PAYMENT' }), {
    paymentStatus: 'PAYMENT_EXPIRED',
    status: 'Cancelled',
    cancellationReason: 'Payment session expired',
  });
  assert.deepEqual(
    expireUnpaidUpdate({ status: 'Cancelled', cancellationReason: 'Item Out of Stock', paymentStatus: 'AWAITING_PAYMENT' }),
    { paymentStatus: 'PAYMENT_EXPIRED' },
  );
  assert.deepEqual(
    expireUnpaidUpdate({ status: 'Completed', paymentStatus: 'AWAITING_PAYMENT' }),
    { paymentStatus: 'PAYMENT_EXPIRED' },
  );
});

test('firestore.indexes.json declares TTL fieldOverrides for daily_reports_sent', () => {
  const indexes = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8'),
  );
  const hasDailyReportsTtl = (indexes.fieldOverrides || []).some(
    (o) => o.collectionGroup === 'daily_reports_sent' && o.fieldPath === 'expireAt' && o.ttl === true,
  );
  assert.equal(hasDailyReportsTtl, true);
});

test('projectOrderSummary returns slim tile fields without items array or customer PII', () => {
  const summary = projectOrderSummary('doc1', {
    orderId: 'LU-261122-120000-ABC',
    customerName: 'Ana',
    customerPhone: '09171234567',
    customerAddress: 'Purok 5',
    lat: 9.02,
    lng: 125.51,
    deliveryFee: 25,
    paymentMethod: 'GCash',
    paymentStatus: 'PAID',
    entryType: 'Kiosk',
    type: 'Delivery',
    status: 'Pending',
    totalAmount: 120,
    items: [
      { name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 2 },
    ],
    timestamp: '2026-11-22T10:00:00.000Z',
  });

  assert.equal(summary.id, 'doc1');
  assert.equal(summary.orderNumber, 'LU-261122-120000-ABC');
  assert.equal(summary.customerName, 'Ana');
  assert.equal(summary.itemsCount, 2);
  assert.equal(summary.total, 120);
  assert.equal('items' in summary, false);
  assert.equal('customerPhone' in summary, false);
  assert.equal('customerAddress' in summary, false);
  assert.equal('lat' in summary, false);
  assert.equal('lng' in summary, false);
});

test('clientIpFromRequest falls back to socket.remoteAddress when headers and ip are missing', () => {
  assert.equal(
    clientIpFromRequest({ socket: { remoteAddress: '198.51.100.7' } }),
    '198.51.100.7',
  );
  assert.equal(
    clientIpFromRequest({ ip: '203.0.113.5', socket: { remoteAddress: '198.51.100.7' } }),
    '203.0.113.5',
  );
});

test('every process.env read in functions/src is declared via defineSecret or explicitly allowlisted', () => {
  const srcRoot = path.resolve(__dirname, '../src');
  const secretsSrc = fs.readFileSync(path.join(srcRoot, 'secrets.ts'), 'utf8');
  const declaredSecrets = new Set(
    [...secretsSrc.matchAll(/defineSecret\(['"]([A-Z0-9_]+)['"]\)/g)].map((m) => m[1]),
  );
  // Optional/runtime env vars with documented fallbacks (see docs/DEPLOYMENT_STATE.md):
  const allowlistedEnv = new Set([
    'PAYMONGO_WEBHOOK_SECRET', // Optional until provisioned; webhook.ts falls back to PayMongo API verification
    'MAPTILER_KEY', // Optional static map fallback in send_notification.ts
    'FUNCTIONS_EMULATOR',
    'FIRESTORE_EMULATOR_HOST',
    'GCLOUD_PROJECT',
    'NODE_ENV',
  ]);

  function walkTs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTs(full, out);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  const unbound = [];
  for (const file of walkTs(srcRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bprocess\.env\.([A-Z0-9_]+)\b/g)) {
      const envName = m[1];
      if (!declaredSecrets.has(envName) && !allowlistedEnv.has(envName)) {
        unbound.push(`${path.relative(srcRoot, file)} -> process.env.${envName}`);
      }
    }
  }
  assert.deepEqual(unbound, [], `Unbound process.env secret reads:\n${unbound.join('\n')}`);

  // Also ensure webhook.ts does not fail closed with 503 when PAYMONGO_WEBHOOK_SECRET is unset
  const webhookSrc = fs.readFileSync(path.join(srcRoot, 'payments', 'webhook.ts'), 'utf8');
  assert.equal(
    webhookSrc.includes('fetchCheckoutSessionDetailed'),
    true,
    'webhook.ts must preserve PayMongo API verification fallback while PAYMONGO_WEBHOOK_SECRET is unprovisioned',
  );
});

test('firebase.json wires firestore.rules and firestore.indexes.json and all TTL collections have fieldOverrides', () => {
  const firebaseJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../firebase.json'), 'utf8'),
  );
  assert.equal(firebaseJson.firestore?.rules, 'firestore.rules');
  assert.equal(firebaseJson.firestore?.indexes, 'firestore.indexes.json');

  const indexes = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8'),
  );
  const ttlGroups = new Set(
    (indexes.fieldOverrides || [])
      .filter((o) => o.fieldPath === 'expireAt' && o.ttl === true)
      .map((o) => o.collectionGroup),
  );
  for (const requiredGroup of [
    'stats_events',
    'rate_limits',
    'login_attempts',
    'kds_orders',
    'order_notifications',
    'daily_reports_sent',
  ]) {
    assert.equal(
      ttlGroups.has(requiredGroup),
      true,
      `firestore.indexes.json missing expireAt TTL fieldOverride for ${requiredGroup}`,
    );
  }
});
