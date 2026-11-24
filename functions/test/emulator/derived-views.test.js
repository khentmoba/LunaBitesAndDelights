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
  assert.strictEqual((await db.doc('kds_orders/c').get()).exists, false, 'unpaid GCash stays out of KDS mirror');

  // Status move: mirror changes, stats untouched.
  await db.doc('orders/a').update({ status: 'Preparing' });
  await until('kds mirror shows Preparing', async () => (await db.doc('kds_orders/a').get()).get('status') === 'Preparing');

  // GCash payment lands → counts and appears in KDS mirror. Cancellation → uncounts. Deletion → mirror removed.
  await db.doc('orders/c').update({ paymentStatus: 'PAID' });
  await until('paid GCash order enters KDS mirror', async () => (await db.doc('kds_orders/c').get()).exists);
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
  const { backfill } = require('../../scripts/backfill-derived-views');
  const before = await call('getLifetimeSalesReport', {});
  // Simulate pre-trigger history: wipe derived views, add an old-day order.
  for (const c of ['dailyStats', 'kds_orders']) {
    for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  }
  await db.doc('orders/unpaid_gcash').set(order({ orderId: 'LU-UNPAID', paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' }));
  await db.doc('dailyStats/2020-01-01').set({ date: '2020-01-01', orders: 9, revenue: 999 }); // stale junk
  const dry = await backfill(db, { log: () => {} });
  assert.strictEqual((await db.doc('dailyStats/2020-01-01').get()).get('orders'), 9, 'dry run writes nothing');
  assert.strictEqual(dry.staleDailyStatsDeleted, 1);
  await backfill(db, { apply: true, log: () => {} });
  assert.ok(!(await db.doc('dailyStats/2020-01-01').get()).exists, 'stale day removed');
  const mirrored = await db.doc('kds_orders/c').get();
  assert.ok(mirrored.exists, 'recent order mirrored');
  assert.ok(mirrored.get('expireAt') instanceof Timestamp, 'backfilled mirror sets expireAt TTL');
  assert.strictEqual(typeof mirrored.get('sourceEventMs'), 'number', 'backfilled mirror sets sourceEventMs');
  assert.ok(!(await db.doc('kds_orders/unpaid_gcash').get()).exists, 'unpaid GCash order excluded from backfilled mirror');
  await db.doc('orders/unpaid_gcash').delete();
  const after = await call('getLifetimeSalesReport', {});
  assert.deepStrictEqual(after, before);
});

test('notifyOrderOnce resumes partial multi-chat failures and reconcileMissedOrderNotifications catches missed orders', async () => {
  const { setBot, setTelegramRetryConfig } = require('../../lib/telegram_api');
  const {
    notifyOrderOnce,
    reconcileMissedOrderNotifications,
    ORDER_NOTIFICATIONS_COLLECTION,
  } = require('../../lib/orders/send_notification');

  process.env.TELEGRAM_TOKEN = 'emulator-test-token';
  process.env.TELEGRAM_CHAT_ID = 'owner-chat, gc-chat';
  setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });

  const sentLog = [];
  let failGc = true;
  setBot({
    sendMessage: async (chatId, text) => {
      sentLog.push({ chatId, text });
      if (chatId === 'gc-chat' && failGc) {
        const err = new Error('ETELEGRAM: 503 Service Unavailable');
        err.response = { statusCode: 503 };
        throw err;
      }
      return { message_id: sentLog.length };
    },
    sendPhoto: async () => ({ message_id: 999 }),
  });

  try {
    const partialOrder = order({
      orderId: 'LU-PARTIAL-1',
      type: 'Pickup',
      lat: null,
      lng: null,
    });
    await assert.rejects(() => notifyOrderOnce('partial1', partialOrder));
    const afterFirst = (await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('partial1').get()).data();
    assert.strictEqual(afterFirst.telegramSent, false);
    assert.strictEqual(afterFirst.telegramStatus, 'failed');
    assert.strictEqual(afterFirst.attempts, 1);
    assert.deepStrictEqual(afterFirst.deliveredChatIds, ['owner-chat']);

    // Retry once GC recovers: only gc-chat receives the message, owner-chat is not duplicated.
    sentLog.length = 0;
    failGc = false;
    const retryRes = await notifyOrderOnce('partial1', partialOrder);
    assert.strictEqual(retryRes.sent, true);
    assert.deepStrictEqual(sentLog.map((s) => s.chatId), ['gc-chat']);
    const afterSecond = (await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('partial1').get()).data();
    assert.strictEqual(afterSecond.telegramSent, true);
    assert.strictEqual(afterSecond.telegramStatus, 'sent');
    assert.strictEqual(afterSecond.attempts, 2);
    assert.deepStrictEqual(afterSecond.deliveredChatIds.sort(), ['gc-chat', 'owner-chat']);

    // Reconciler test: seed missed (>30s), brand-new (<30s), unpaid GCash, cancelled, and completed orders.
    sentLog.length = 0;
    const nowMs = Date.now();
    const twoMinAgo = Timestamp.fromMillis(nowMs - 2 * 60 * 1000);
    const fiveSecAgo = Timestamp.fromMillis(nowMs - 5 * 1000);

    await db.doc('orders/rec_missed').set(order({ orderId: 'LU-MISSED', type: 'Pickup', timestamp: twoMinAgo }));
    await db.doc('orders/rec_fresh').set(order({ orderId: 'LU-FRESH', type: 'Pickup', timestamp: fiveSecAgo }));
    await db.doc('orders/rec_unpaid').set(order({
      orderId: 'LU-UNPAID-REC', type: 'Pickup', paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT', timestamp: twoMinAgo,
    }));
    await db.doc('orders/rec_cancelled').set(order({
      orderId: 'LU-CANCEL-REC', type: 'Pickup', status: 'Cancelled', timestamp: twoMinAgo,
    }));
    // A transient Telegram outage left a failed claim behind before staff cancelled
    // the order. The reconciler must not announce an order the trigger, the callable
    // and `shouldNotifyKitchen` all refuse to announce.
    await db.doc('orders/rec_cancelled_claimed').set(order({
      orderId: 'LU-CANCEL-CLAIMED', type: 'Pickup', status: 'Cancelled', timestamp: twoMinAgo,
    }));
    await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_cancelled_claimed').set({
      telegramSent: false,
      telegramStatus: 'failed',
      attempts: 1,
    });
    await db.doc('orders/rec_completed').set(order({
      orderId: 'LU-DONE-REC', type: 'Pickup', status: 'Completed', timestamp: twoMinAgo,
    }));
    await db.doc('orders/rec_sent').set(order({ orderId: 'LU-SENT-REC', type: 'Pickup', timestamp: twoMinAgo }));
    await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_sent').set({
      telegramSent: true,
      telegramStatus: 'sent',
    });
    // Order whose trigger burned 100 retries during an outage must still be reconciled.
    await db.doc('orders/rec_after_outage').set(order({ orderId: 'LU-OUTAGE-REC', type: 'Pickup', timestamp: twoMinAgo }));
    await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_after_outage').set({
      telegramSent: false,
      telegramStatus: 'failed',
      attempts: 100,
    });
    // Delayed GCash order created >2h ago (outside timestamp lookback) but paid 2m ago must be reconciled.
    await db.doc('orders/rec_delayed_gcash').set(order({
      orderId: 'LU-DELAYED-GCASH',
      type: 'Pickup',
      paymentMethod: 'GCash',
      paymentStatus: 'PAID',
      timestamp: Timestamp.fromMillis(nowMs - 5 * 60 * 60 * 1000),
      paidAt: new Date(nowMs - 2 * 60 * 1000).toISOString(),
    }));

    const summary = await reconcileMissedOrderNotifications(db, { nowMs });
    assert.strictEqual(summary.retried, 3);
    assert.strictEqual(summary.sent, 3);
    assert.strictEqual(summary.failed, 0);
    assert.deepStrictEqual(
      sentLog.map((s) => s.chatId).sort(),
      ['gc-chat', 'gc-chat', 'gc-chat', 'owner-chat', 'owner-chat', 'owner-chat'],
    );
    assert.ok(sentLog.some((s) => s.text.includes('LU\\-MISSED')));
    assert.ok(sentLog.some((s) => s.text.includes('LU\\-OUTAGE\\-REC')));
    assert.ok(sentLog.some((s) => s.text.includes('LU\\-DELAYED\\-GCASH')));
    assert.ok(
      !sentLog.some((s) => s.text.includes('LU\\-CANCEL\\-CLAIMED')),
      'a cancelled order with a failed claim must never be announced',
    );
    const cancelledNotif = await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_cancelled_claimed').get();
    assert.strictEqual(cancelledNotif.get('telegramSent'), false);
    assert.strictEqual(cancelledNotif.get('telegramStatus'), 'failed');
    assert.strictEqual(cancelledNotif.get('reconcileAttempts'), undefined);
    assert.strictEqual(
      (await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_missed').get()).get('telegramSent'),
      true,
    );
    const outageNotif = (await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_after_outage').get()).data();
    assert.strictEqual(outageNotif.telegramSent, true);
    assert.strictEqual(outageNotif.reconcileAttempts, 1);
    assert.strictEqual(outageNotif.attempts, 101);
    // Second run is a clean no-op.
    sentLog.length = 0;
    const secondRun = await reconcileMissedOrderNotifications(db, { nowMs });
    assert.strictEqual(secondRun.retried, 0);
    assert.strictEqual(sentLog.length, 0);
  } finally {
    setBot(null);
    setTelegramRetryConfig(null);
    delete process.env.TELEGRAM_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test('reconcileMissedPaymentNotifications reclaims a payment alert that was sent but never persisted', async () => {
  const { setBot, setTelegramRetryConfig } = require('../../lib/telegram_api');
  const {
    reconcileMissedPaymentNotifications,
    ORDER_NOTIFICATIONS_COLLECTION,
  } = require('../../lib/orders/send_notification');

  process.env.TELEGRAM_TOKEN = 'emulator-test-token';
  process.env.TELEGRAM_CHAT_ID = 'owner-chat';
  setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });
  const sentLog = [];
  setBot({
    sendMessage: async (chatId, text) => {
      sentLog.push({ chatId, text });
      return { message_id: sentLog.length };
    },
    sendPhoto: async () => ({ message_id: 999 }),
  });

  try {
    const nowMs = Date.now();
    // An earlier test left a paid GCash order in the emulator; mark its payment
    // alert handled so this case stays isolated to the doc seeded below.
    await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_delayed_gcash').set({
      paymentNotifSent: true,
      paymentNotifStatus: 'sent',
    }, { merge: true });
    await db.doc('orders/rec_payment').set(order({
      orderId: 'LU-PAY-REC',
      paymentMethod: 'GCash',
      paymentStatus: 'PAID',
      paidAt: new Date(nowMs - 2 * 60 * 1000).toISOString(),
      timestamp: Timestamp.fromMillis(nowMs - 5 * 60 * 60 * 1000),
    }));
    // Telegram delivery fired but every sent-state write failed; the lease has
    // since expired, so only a scheduled pass can still reclaim this alert.
    await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_payment').set({
      telegramSent: true,
      telegramStatus: 'sent',
      paymentNotifStatus: 'sending',
      paymentNotifClaimedAt: nowMs - 10 * 60 * 1000,
      paymentNotifSent: false,
    });

    const summary = await reconcileMissedPaymentNotifications(db, { nowMs });
    assert.strictEqual(summary.retried, 1);
    assert.strictEqual(summary.sent, 1);
    assert.ok(sentLog.some((s) => s.text.includes('LU\\-PAY\\-REC')));
    const notif = (await db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc('rec_payment').get()).data();
    assert.strictEqual(notif.paymentNotifSent, true);
    assert.strictEqual(notif.paymentReconcileAttempts, 1);

    sentLog.length = 0;
    const second = await reconcileMissedPaymentNotifications(db, { nowMs });
    assert.strictEqual(second.retried, 0);
    assert.strictEqual(sentLog.length, 0);
  } finally {
    setBot(null);
    setTelegramRetryConfig(null);
    delete process.env.TELEGRAM_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test('placeOrder and updateOrderStatus write kds_orders atomically without waiting for trigger lag', async () => {
  const placed = await call('placeOrder', {
    type: 'Pickup',
    paymentMethod: 'Cash',
    customerName: 'Instant Test',
    customerPhone: '09171234567',
    items: [{ name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 1 }],
    idempotencyKey: 'instant_kds_mirror_test_0001',
  });
  assert.strictEqual(placed.success, true);
  // Immediately after placeOrder returns, kds_orders/{docId} must already exist
  // without polling or waiting for the async onOrderWritten trigger.
  const immediateSnap = await db.doc(`kds_orders/${placed.docId}`).get();
  assert.strictEqual(immediateSnap.exists, true, 'kds_orders doc must exist immediately after placeOrder');
  assert.strictEqual(immediateSnap.get('status'), 'Pending');
  assert.strictEqual(immediateSnap.get('customerName'), 'Instant Test');
  assert.ok(immediateSnap.get('ts') instanceof Timestamp);
  assert.ok(immediateSnap.get('expireAt') instanceof Timestamp);

  // Immediately after updateOrderStatus returns, kds_orders/{docId} must reflect Preparing.
  const moved = await call('updateOrderStatus', { orderId: placed.docId, status: 'Preparing' });
  assert.strictEqual(moved.success, true);
  assert.strictEqual(moved.changed, true);
  const movedSnap = await db.doc(`kds_orders/${placed.docId}`).get();
  assert.strictEqual(movedSnap.get('status'), 'Preparing', 'kds_orders must reflect Preparing immediately');

  // Unpaid customer GCash order must NOT appear in kds_orders until paid.
  const unpaidRes = await fetch(`${FUNCTIONS}/placeOrder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'Pickup',
        paymentMethod: 'GCash',
        customerName: 'Unpaid GCash',
        customerPhone: '09171234568',
        items: [{ name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 1 }],
        idempotencyKey: 'unpaid_gcash_kds_test_0001',
      },
    }),
  });
  assert.strictEqual(unpaidRes.ok, true);
  const unpaidBody = await unpaidRes.json();
  const unpaidMirror = await db.doc(`kds_orders/${unpaidBody.result.docId}`).get();
  assert.strictEqual(unpaidMirror.exists, false, 'unpaid GCash order must stay out of kds_orders');
});
