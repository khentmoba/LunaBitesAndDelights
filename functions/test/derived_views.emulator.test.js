// End-to-end: the deployed onOrderWritten trigger keeps kds_orders and
// dailyStats in step with orders, and getLifetimeSalesReport reads them.
// Run with: npm run test:derived (Functions + Firestore emulators, demo project).
const test = require('node:test');
const assert = require('node:assert');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) {
  throw new Error('Run via `npm run test:derived` (demo project emulators only).');
}

const PROJECT = process.env.GCLOUD_PROJECT;
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const FUNCTIONS = `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${PROJECT}/us-central1`;
const log = [];

async function until(label, fn, ms = 20000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) { log.push(`${label}: ${Date.now() - start} ms`); return v; }
    if (Date.now() - start > ms) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Unsigned ID token; the Functions emulator decodes without verifying.
function staffToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now, iat: now, exp: now + 3600,
    sub: 'staff_tester', user_id: 'staff_tester', role: 'staff',
  })}.`;
}

async function call(name, data = {}) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken()}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(body)}`);
  return body.result;
}

const order = (over) => ({
  orderId: 'LU-T', customerName: 'Ana', customerPhone: '09170000000', customerAddress: 'Purok 5',
  items: [{ name: 'Shawarma Wrap', variant: 'Spicy', price: 79, quantity: 2 }],
  totalAmount: 158, type: 'Delivery', entryType: 'Kiosk', paymentMethod: 'Cash',
  paymentStatus: 'NOT PAID', status: 'Pending', dateLabel: '2026-11-15',
  timestamp: Timestamp.now(), checkoutSessionId: 'cs_secret', paymongoPaymentId: 'pay_secret',
  ...over,
});

test('trigger mirrors orders and keeps daily stats exact', async () => {
  const day = db.doc('dailyStats/2026-11-15');
  const legacy = await call('getLifetimeSalesReport', {});
  assert.strictEqual(legacy.summary.orderCount, 0);

  await db.doc('orders/a').set(order({ orderId: 'LU-A' }));
  await db.doc('orders/b').set(order({ orderId: 'LU-B', type: 'Walk-In', entryType: 'Staff', totalAmount: 99,
    items: [{ name: 'Burger B1T1', price: 99, quantity: 1 }] }));
  await db.doc('orders/c').set(order({ orderId: 'LU-C', paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' }));

  const mirror = await until('kds mirror for a new order', async () => (await db.doc('kds_orders/a').get()).data());
  assert.strictEqual(mirror.orderNumber, 'LU-A');
  assert.strictEqual(mirror.status, 'Pending');
  assert.ok(mirror.ts instanceof Timestamp);
  assert.strictEqual(mirror.checkoutSessionId, undefined, 'payment ids stay out of the staff mirror');
  assert.strictEqual(mirror.paymongoPaymentId, undefined);

  await until('dailyStats counts 2 countable orders', async () => (await day.get()).get('orders') === 2);

  // Status move: mirror changes, stats untouched.
  await db.doc('orders/a').update({ status: 'Preparing' });
  await until('kds mirror shows Preparing', async () => (await db.doc('kds_orders/a').get()).get('status') === 'Preparing');

  // GCash payment lands → counts. Cancellation → uncounts. Deletion → mirror removed.
  await db.doc('orders/c').update({ paymentStatus: 'PAID' });
  await until('paid GCash order counted', async () => (await day.get()).get('orders') === 3);
  await db.doc('orders/b').update({ status: 'Cancelled', cancellationReason: 'test' });
  await until('cancelled order uncounted', async () => (await day.get()).get('orders') === 2);
  await db.doc('orders/a').delete();
  await until('deleted order leaves mirror', async () => !(await db.doc('kds_orders/a').get()).exists);
  await until('deleted order uncounted', async () => (await day.get()).get('orders') === 1);

  const stats = (await day.get()).data();
  assert.strictEqual(stats.revenue, 158);
  assert.strictEqual(stats.paymentMethod.gcash.count, 1);
  assert.strictEqual(stats.paymentMethod.cash.count, 0);
  assert.strictEqual(stats.channel.walkIn.count, 0);
  assert.strictEqual(stats.items['Shawarma Wrap (Spicy)'].qty, 2);

  // Before backfill the report scans orders; after, it reads dailyStats. Same answer.
  const scanned = await call('getLifetimeSalesReport', {});
  await db.doc('stats_meta/dailyStats').set({ backfilledAt: Timestamp.now() });
  const fromStats = await call('getLifetimeSalesReport', {});
  const ranged = await call('getLifetimeSalesReport', { startDate: '2026-11-15', endDate: '2026-11-15' });
  assert.deepStrictEqual(fromStats, scanned);
  assert.deepStrictEqual(ranged.summary, scanned.summary);
  assert.strictEqual(fromStats.summary.orderCount, 1);
  assert.strictEqual(fromStats.summary.totalRevenue, 158);

  console.log(JSON.stringify({ timings: log, dailyStats: stats, report: fromStats.summary }, null, 2));
});

test('backfill rebuilds dailyStats and the mirror from orders alone', async () => {
  const { backfill } = require('../scripts/backfill-derived-views');
  const before = await call('getLifetimeSalesReport', {});
  // Simulate pre-trigger history: wipe derived views, add an old-day order.
  for (const c of ['dailyStats', 'kds_orders']) {
    for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  }
  await db.doc('dailyStats/2020-01-01').set({ date: '2020-01-01', orders: 9, revenue: 999 }); // stale junk
  const dry = await backfill(db, { log: () => {} });
  assert.strictEqual((await db.doc('dailyStats/2020-01-01').get()).get('orders'), 9, 'dry run writes nothing');
  assert.strictEqual(dry.staleDailyStatsDeleted, 1);
  await backfill(db, { apply: true, log: () => {} });
  assert.ok(!(await db.doc('dailyStats/2020-01-01').get()).exists, 'stale day removed');
  assert.ok((await db.doc('kds_orders/c').get()).exists, 'recent order mirrored');
  const after = await call('getLifetimeSalesReport', {});
  assert.deepStrictEqual(after, before);
});
