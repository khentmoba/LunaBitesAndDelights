const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { shouldNotifyPaymentConfirmed } = require('../lib/orders/derived');
const { Timestamp } = require('firebase-admin/firestore');
const {
  evaluatePaymentNotificationClaim,
  hasOrderNotificationState,
  TELEGRAM_CLAIM_TTL_MS,
} = require('../lib/orders/send_notification');
const { canClaimDailyReport, scheduledReportDate } = require('../lib/reporting/daily_report');
const { isStaleUnpaidOrder, expireUnpaidUpdate, STALE_UNPAID_AGE_MS } = require('../lib/orders/expire_unpaid');
const { projectOrderSummary, getLegacyItemCounts } = require('../lib/orders/kds');
const { clientIpFromRequest } = require('../lib/util/security');
const {
  scanOrdersForDate, FALLBACK_PAGE_SIZE, MAX_FALLBACK_PAGES,
} = require('../lib/reporting/daily_stats');

function ttlCollectionsFromSources(sources) {
  const ts = require('typescript');
  const collections = new Set();

  for (const { fileName, text } of sources) {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const stringConstants = new Map();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) {
          stringConstants.set(declaration.name.text, declaration.initializer.text);
        }
      }
    }

    const findDeclaration = (node, name) => {
      for (let scope = node.parent; scope; scope = scope.parent) {
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
          }
        }
      }
      return undefined;
    };
    const stringValue = (node) => {
      if (ts.isStringLiteral(node)) return node.text;
      if (ts.isIdentifier(node)) return stringConstants.get(node.text);
      return undefined;
    };
    const collectionForRef = (node) => {
      if (ts.isIdentifier(node)) {
        const declaration = findDeclaration(node, node.text);
        return declaration?.initializer ? collectionForRef(declaration.initializer) : undefined;
      }
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
      const method = node.expression.name.text;
      if (method === 'doc') return collectionForRef(node.expression.expression);
      if (method === 'collection') return stringValue(node.arguments[0]);
      return undefined;
    };
    const containsExpireAt = (node) => {
      if (ts.isIdentifier(node)) {
        const declaration = findDeclaration(node, node.text);
        return Boolean(declaration?.initializer && containsExpireAt(declaration.initializer));
      }
      if (!ts.isObjectLiteralExpression(node)) return false;
      return node.properties.some((property) => {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
            ? property.name.text
            : '';
          return name === 'expireAt';
        }
        return ts.isSpreadAssignment(property) && containsExpireAt(property.expression);
      });
    };

    const visit = (node) => {
      const isWrite = ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ['set', 'create', 'add'].includes(node.expression.name.text);
      if (isWrite) {
        const ref = node.arguments.length > 1 ? node.arguments[0] : node.expression.expression;
        const data = node.arguments.length > 1 ? node.arguments[1] : node.arguments[0];
        if (data && containsExpireAt(data)) {
          const collection = collectionForRef(ref);
          assert.ok(collection, `Could not resolve expireAt write collection in ${fileName}`);
          collections.add(collection);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return collections;
}

function fakeOrdersDb(pageSize) {
  let gets = 0;
  const rows = Array.from({ length: pageSize }, (_, i) => ({ id: `o${i}`, data: () => ({}) }));
  const query = {
    where: () => query,
    limit: () => query,
    startAfter: () => query,
    get: async () => {
      gets++;
      return { size: rows.length, docs: rows, empty: rows.length === 0 };
    },
  };
  return { db: { collection: () => query }, gets: () => gets };
}

test('scheduled daily reports use the scheduled PHT day rather than the late retry day', () => {
  const scheduleTime = '2026-11-23T14:00:00.000Z'; // 22:00 PHT on Nov 23
  const lateRetry = '2026-11-23T16:10:00.000Z'; // 00:10 PHT on Nov 24
  assert.equal(scheduledReportDate(scheduleTime, lateRetry), '2026-11-23');
  assert.equal(scheduledReportDate(undefined, lateRetry), '2026-11-24');
  assert.equal(scheduledReportDate(undefined, 'invalid', new Date('2026-11-23T16:10:00.000Z')), '2026-11-24');
});

test('summary-only KDS queries use persisted counts and retain a legacy item-count path', async () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/orders/kds.ts'), 'utf8');
  const fields = src.match(/const SUMMARY_ORDER_FIELDS = \[([\s\S]*?)\] as const/);
  assert.ok(fields);
  assert.match(fields[1], /'itemsCount'/);
  assert.doesNotMatch(fields[1], /'items'/);
  assert.match(src, /db\.getAll\([\s\S]*fieldMask:\s*\['items'\]/);

  const legacyRef = { id: 'legacy-ref' };
  const db = {
    getAll: async (...args) => {
      assert.deepEqual(args.slice(0, -1), [legacyRef]);
      assert.deepEqual(args.at(-1), { fieldMask: ['items'] });
      return [{
        id: 'legacy',
        exists: true,
        get: (field) => field === 'items' ? [{ quantity: 2 }, { qty: 1 }] : undefined,
      }];
    },
  };
  const docs = [
    { ref: legacyRef, get: (field) => field === 'itemsCount' ? undefined : undefined },
    { ref: { id: 'new-ref' }, get: (field) => field === 'itemsCount' ? 4 : undefined },
  ];
  const counts = await getLegacyItemCounts(db, docs);
  assert.equal(counts.get('legacy'), 3);
  assert.equal(counts.has('new'), false);
  assert.equal(projectOrderSummary('legacy', { itemsCount: undefined }, counts.get('legacy')).itemsCount, 3);
  assert.equal(projectOrderSummary('old', { items: [{ quantity: 2 }] }).itemsCount, 2);

  const placeOrder = fs.readFileSync(path.resolve(__dirname, '../src/orders/place_order.ts'), 'utf8');
  assert.match(placeOrder, /itemsCount:\s*items\.reduce/);
});

test('payment-only notification records do not qualify as order notification claims', () => {
  assert.equal(hasOrderNotificationState({ paymentNotifSent: true, paymentNotifStatus: 'sent' }), false);
  assert.equal(hasOrderNotificationState({ telegramSent: false, telegramStatus: 'failed' }), true);
  const notifSrc = fs.readFileSync(path.resolve(__dirname, '../src/orders/send_notification.ts'), 'utf8');
  assert.match(notifSrc, /terminal && !hasOrderNotificationState\(notifData\)/);
});

test('scanOrdersForDate stops at the page cap instead of reading a whole busy day', async () => {
  const { db, gets } = fakeOrdersDb(FALLBACK_PAGE_SIZE);
  await assert.rejects(
    () => scanOrdersForDate(db, '2026-11-23'),
    (err) => err && err.code === 'failed-precondition',
  );
  assert.strictEqual(gets(), MAX_FALLBACK_PAGES);
});

test('scanOrdersForDate returns one short page and stops', async () => {
  const { db, gets } = fakeOrdersDb(3);
  const docs = await scanOrdersForDate(db, '2026-11-23');
  assert.strictEqual(docs.length, 3);
  assert.strictEqual(gets(), 1);
});

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

  // HMAC is mandatory, but the PayMongo API verification remains a second
  // check after the signature passes.
  const webhookSrc = fs.readFileSync(path.join(srcRoot, 'payments', 'webhook.ts'), 'utf8');
  assert.equal(
    webhookSrc.includes('fetchCheckoutSessionDetailed'),
    true,
    'webhook.ts must preserve PayMongo API verification after HMAC validation',
  );
  assert.match(webhookSrc, /if \(!webhookSecret\) return false;/);
});

test('firebase config TTL overrides exactly cover Firestore expireAt writes', () => {
  const root = path.resolve(__dirname, '../..');
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  assert.equal(firebaseJson.firestore?.rules, 'firestore.rules');
  assert.equal(firebaseJson.firestore?.indexes, 'firestore.indexes.json');

  const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'));
  const ttlGroups = new Set(
    (indexes.fieldOverrides || [])
      .filter((override) => override.fieldPath === 'expireAt' && override.ttl === true)
      .map((override) => override.collectionGroup),
  );
  const srcRoot = path.join(root, 'functions/src');
  const sourceFiles = [];
  function walkTs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTs(full);
      else if (entry.name.endsWith('.ts')) sourceFiles.push({ fileName: full, text: fs.readFileSync(full, 'utf8') });
    }
  }
  walkTs(srcRoot);

  const ttlWrites = ttlCollectionsFromSources(sourceFiles);
  assert.deepEqual([...ttlGroups].sort(), [...ttlWrites].sort());
  assert.deepEqual(
    [...ttlCollectionsFromSources([{
      fileName: 'fixture.ts',
      text: "function save(db) { const ref = db.collection('future_ttl').doc('x'); ref.set({ expireAt: 123 }); }",
    }])],
    ['future_ttl'],
  );
});

test('parsePaymongoCheckoutResponse validates session id and HTTPS PayMongo-family checkout URL', () => {
  const { parsePaymongoCheckoutResponse } = require('../lib/payments/create_checkout');
  assert.deepEqual(
    parsePaymongoCheckoutResponse({
      data: {
        id: 'cs_live_123456',
        attributes: { checkout_url: 'https://checkout.paymongo.com/cs_live_123456' },
      },
    }),
    {
      sessionId: 'cs_live_123456',
      checkoutUrl: 'https://checkout.paymongo.com/cs_live_123456',
    },
  );
  assert.equal(parsePaymongoCheckoutResponse(null), null);
  assert.equal(parsePaymongoCheckoutResponse({ data: { id: '', attributes: { checkout_url: 'https://checkout.paymongo.com/x' } } }), null);
  assert.equal(parsePaymongoCheckoutResponse({ data: { id: 'cs_1234', attributes: { checkout_url: 'http://checkout.paymongo.com/x' } } }), null);
  assert.equal(parsePaymongoCheckoutResponse({ data: { id: 'cs_1234', attributes: { checkout_url: 'https://evil.example/phish' } } }), null);
});

test('isValidCalendarDate and resolveReportDateRange reject invalid dates and inverted ranges', () => {
  const { isValidCalendarDate, resolveReportDateRange } = require('../lib/reporting/lifetime_report');
  assert.equal(isValidCalendarDate('2026-02-28'), true);
  assert.equal(isValidCalendarDate('2026-02-29'), false);
  assert.equal(isValidCalendarDate('2026-02-31'), false);
  assert.equal(isValidCalendarDate('2026-99-99'), false);
  assert.equal(isValidCalendarDate('2024-02-29'), true);

  assert.deepEqual(
    resolveReportDateRange({ startDate: '2026-01-01', endDate: '2026-01-31' }, '2026-11-23'),
    { start: '2026-01-01', end: '2026-01-31', isAllTime: false },
  );
  assert.throws(
    () => resolveReportDateRange({ startDate: '2026-02-31' }, '2026-11-23'),
    (err) => err?.code === 'invalid-argument',
  );
  assert.throws(
    () => resolveReportDateRange({ startDate: '2026-05-10', endDate: '2026-05-01' }, '2026-11-23'),
    (err) => err?.code === 'invalid-argument',
  );
});

test('expireStaleUnpaidBatch isolates per-order transaction contention and expires remaining orders', async () => {
  const { expireStaleUnpaidBatch, STALE_UNPAID_AGE_MS } = require('../lib/orders/expire_unpaid');
  const now = Date.parse('2026-11-23T03:00:00.000Z');
  const staleIso = new Date(now - STALE_UNPAID_AGE_MS - 60_000).toISOString();
  const docs = new Map([
    ['ord_fail', { paymentStatus: 'AWAITING_PAYMENT', status: 'Pending', timestamp: staleIso }],
    ['ord_ok', { paymentStatus: 'AWAITING_PAYMENT', status: 'Pending', timestamp: staleIso }],
  ]);

  const fakeDb = {
    collection() {
      return {
        where() { return this; },
        limit() { return this; },
        startAfter() { return this; },
        async get() {
          return {
            empty: false,
            docs: [...docs.entries()].map(([id, data]) => ({
              id,
              ref: { id },
              data: () => ({ ...data }),
            })),
          };
        },
      };
    },
    async runTransaction(fn) {
      let touchedId = null;
      const tx = {
        async get(ref) {
          touchedId = ref.id;
          if (ref.id === 'ord_fail') throw new Error('ABORTED: transaction contention');
          const d = docs.get(ref.id);
          return { exists: !!d, data: () => ({ ...d }) };
        },
        update(ref, patch) {
          docs.set(ref.id, { ...docs.get(ref.id), ...patch });
        },
      };
      const result = await fn(tx);
      if (touchedId === 'ord_fail') throw new Error('should not reach');
      return result;
    },
  };

  const res = await expireStaleUnpaidBatch(fakeDb, now);
  assert.deepEqual(res, { expired: 1, failed: 1 });
  assert.equal(docs.get('ord_ok').paymentStatus, 'PAYMENT_EXPIRED');
  assert.equal(docs.get('ord_ok').status, 'Cancelled');
  assert.equal(docs.get('ord_fail').paymentStatus, 'AWAITING_PAYMENT');
});

test('notifyPaymentConfirmedOnce persists partial deliveries and never flips status to failed after Telegram send', async () => {
  const {
    notifyPaymentConfirmedOnce,
    evaluatePaymentNotificationClaim,
  } = require('../lib/orders/send_notification');
  const telegramApi = require('../lib/telegram_api');
  const { telegramChatIds } = require('../lib/secrets');

  assert.equal(
    evaluatePaymentNotificationClaim({ paymentNotifStatus: 'failed_permanent' }),
    'failed-permanent',
  );

  const origChatIds = telegramChatIds.value;
  telegramChatIds.value = () => 'chatA,chatB';
  telegramApi.setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });

  const store = new Map();
  let failPersist = false;
  const fakeDb = {
    collection() {
      return {
        doc(id) {
          return {
            id,
            async set(data, opts) {
              if (failPersist && data.paymentNotifStatus === 'sent') {
                throw new Error('transient firestore write error');
              }
              const prev = opts?.merge ? (store.get(id) || {}) : {};
              store.set(id, { ...prev, ...data });
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const d = store.get(ref.id);
          return { exists: !!d, data: () => ({ ...d }) };
        },
        set(ref, data, opts) {
          const prev = opts?.merge ? (store.get(ref.id) || {}) : {};
          store.set(ref.id, { ...prev, ...data });
        },
      };
      return fn(tx);
    },
  };

  const sentTo = [];
  let failChatB = true;
  telegramApi.setBot({
    async sendMessage(chatId) {
      sentTo.push(chatId);
      if (chatId === 'chatB' && failChatB) {
        const err = new Error('ETELEGRAM: 500 Internal Server Error');
        err.response = { statusCode: 500 };
        throw err;
      }
      return { message_id: 1 };
    },
    async sendPhoto() { return {}; },
  });

  try {
    await assert.rejects(
      () => notifyPaymentConfirmedOnce('ord1', { orderId: 'LU-1', totalAmount: 100 }, { db: fakeDb, persistBackoffMs: [0] }),
    );
    assert.deepEqual(store.get('ord1').paymentDeliveredChatIds, ['chatA']);
    assert.equal(store.get('ord1').paymentNotifStatus, 'failed');

    // Retry only sends to chatB, and even if Firestore persist fails, status is NOT overwritten to 'failed'.
    failChatB = false;
    failPersist = true;
    sentTo.length = 0;
    const res = await notifyPaymentConfirmedOnce('ord1', { orderId: 'LU-1', totalAmount: 100 }, { db: fakeDb, persistBackoffMs: [0] });
    assert.equal(res.sent, true);
    assert.deepEqual(sentTo, ['chatB'], 'already-delivered chatA must be skipped on retry');
    assert.equal(store.get('ord1').paymentNotifStatus, 'sending', 'status must not be overwritten to failed after Telegram succeeded');
  } finally {
    telegramChatIds.value = origChatIds;
    telegramApi.setBot(null);
    telegramApi.setTelegramRetryConfig(null);
  }
});

test('runDailySalesReport tracks partial deliveries, skips permanent errors, and avoids duplicate sends on persist failure', async () => {
  const { runDailySalesReport, canClaimDailyReport } = require('../lib/reporting/daily_report');
  const telegramApi = require('../lib/telegram_api');
  const { telegramChatIds } = require('../lib/secrets');

  assert.equal(canClaimDailyReport({ status: 'failed_permanent' }), false);

  const origChatIds = telegramChatIds.value;
  telegramChatIds.value = () => 'chat1,chat2';
  telegramApi.setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });

  const store = new Map();
  let failPersist = false;
  const fakeDb = {
    collection() {
      return {
        doc(id) {
          return {
            id,
            async set(data, opts) {
              if (failPersist && data.status === 'sent') {
                throw new Error('transient firestore write error');
              }
              const prev = opts?.merge ? (store.get(id) || {}) : {};
              store.set(id, { ...prev, ...data });
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const d = store.get(ref.id);
          return { exists: !!d, data: () => ({ ...d }) };
        },
        set(ref, data, opts) {
          const prev = opts?.merge ? (store.get(ref.id) || {}) : {};
          store.set(ref.id, { ...prev, ...data });
        },
      };
      return fn(tx);
    },
  };

  const sentTo = [];
  let failChat2 = true;
  telegramApi.setBot({
    async sendMessage(chatId) {
      sentTo.push(chatId);
      if (chatId === 'chat2' && failChat2) {
        const err = new Error('ETELEGRAM: 503 Unavailable');
        err.response = { statusCode: 503 };
        throw err;
      }
      return { message_id: 2 };
    },
    async sendPhoto() { return {}; },
  });

  try {
    await assert.rejects(
      () => runDailySalesReport('2026-11-23', { db: fakeDb, persistBackoffMs: [0], aggregate: async () => null }),
    );
    assert.deepEqual(store.get('2026-11-23').deliveredChatIds, ['chat1']);
    assert.equal(store.get('2026-11-23').status, 'failed');

    failChat2 = false;
    failPersist = true;
    sentTo.length = 0;
    const res = await runDailySalesReport('2026-11-23', { db: fakeDb, persistBackoffMs: [0], aggregate: async () => null });
    assert.equal(res.sent, true);
    assert.deepEqual(sentTo, ['chat2']);
    assert.equal(store.get('2026-11-23').status, 'sending');
  } finally {
    telegramChatIds.value = origChatIds;
    telegramApi.setBot(null);
    telegramApi.setTelegramRetryConfig(null);
  }
});

test('runManualSalesReport skips chats that already received a failed attempt, then resets', async () => {
  const { runManualSalesReport, manualReportGuardId } = require('../lib/reporting/manual_report');
  const telegramApi = require('../lib/telegram_api');
  const { telegramChatIds } = require('../lib/secrets');

  assert.equal(manualReportGuardId('2026-11-23'), 'manual-2026-11-23');

  const origChatIds = telegramChatIds.value;
  telegramChatIds.value = () => 'chat1,chat2';
  telegramApi.setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });

  const store = new Map();
  const fakeDb = {
    collection(name) {
      return {
        doc(id) {
          const ref = {
            id: `${name}/${id}`,
            async get() {
              const d = store.get(ref.id);
              return { exists: Boolean(d), data: () => ({ ...d }) };
            },
            async set(data, opts) {
              const prev = opts?.merge ? (store.get(ref.id) || {}) : {};
              store.set(ref.id, { ...prev, ...data });
            },
          };
          return ref;
        },
      };
    },
  };

  const sentTo = [];
  let failChat2 = true;
  telegramApi.setBot({
    async sendMessage(chatId) {
      sentTo.push(chatId);
      if (chatId === 'chat2' && failChat2) {
        const err = new Error('ETELEGRAM: 503 Unavailable');
        err.response = { statusCode: 503 };
        throw err;
      }
      return { message_id: 1 };
    },
    async sendPhoto() { return {}; },
  });

  const aggregate = async () => ({
    date: '2026-11-23', totalSales: 500, totalOrders: 3, kioskSales: 400, staffSales: 100, topItems: [],
  });
  const guardKey = 'daily_reports_sent/manual-2026-11-23';

  try {
    await assert.rejects(
      () => runManualSalesReport('2026-11-23', { db: fakeDb, aggregate }),
      /Telegram messages failed/,
    );
    assert.deepEqual(store.get(guardKey).deliveredChatIds, ['chat1'], 'partial delivery is remembered');
    assert.equal(store.get(guardKey).status, 'failed');
    assert.equal(store.get(guardKey).expireAt instanceof Timestamp, true, 'guard doc is TTL-bounded');

    failChat2 = false;
    sentTo.length = 0;
    const retry = await runManualSalesReport('2026-11-23', { db: fakeDb, aggregate });
    assert.equal(retry.sent, true);
    assert.equal(retry.skippedChats, 1);
    assert.deepEqual(sentTo, ['chat2'], 'the chat that already got it is not spammed again');
    assert.deepEqual(store.get(guardKey).deliveredChatIds, []);
    assert.equal(store.get(guardKey).status, 'sent');

    sentTo.length = 0;
    const again = await runManualSalesReport('2026-11-23', { db: fakeDb, aggregate });
    assert.equal(again.sent, true);
    assert.deepEqual(sentTo, ['chat1', 'chat2'], 'a deliberate second report still reaches everyone');

    const empty = await runManualSalesReport('2026-11-24', { db: fakeDb, aggregate: async () => null });
    assert.deepEqual(empty, { sent: false, message: 'No orders found for today', skippedChats: 0 });
  } finally {
    telegramChatIds.value = origChatIds;
    telegramApi.setBot(null);
    telegramApi.setTelegramRetryConfig(null);
  }
});

test('a paid session that cannot be attached to an order is reported instead of dropped', () => {
  const { checkPaidSession } = require('../lib/payments/webhook');
  const paidFor = (amount) => [{ attributes: { status: 'paid', amount } }];

  // No metadata.order_doc_id and no usable reference_number: nothing links the money to an order.
  assert.deepEqual(checkPaidSession({}, paidFor(5000)), {
    ok: false,
    reason: 'has no order reference; nothing was marked PAID',
  });
  // The order resolves, but the paid payment carries no integer amount.
  assert.deepEqual(checkPaidSession({ metadata: { order_doc_id: 'ord123' } }, [{ attributes: { status: 'paid' } }]), {
    ok: false,
    reason: 'for order ord123 reported no integer paid amount; it stays unpaid for review',
  });
  assert.equal(checkPaidSession({ metadata: { order_doc_id: 'ord123' } }, []).ok, false);
  assert.equal(checkPaidSession({ metadata: { order_doc_id: 'ord123' } }, paidFor(26.5)).ok, false);

  assert.deepEqual(checkPaidSession({ metadata: { order_doc_id: 'ord123' } }, paidFor(26300)), {
    ok: true,
    docId: 'ord123',
    paidCentavos: 26300,
  });
  // A legacy order number in reference_number is still accepted.
  assert.deepEqual(checkPaidSession({ reference_number: 'LU-261124-113045-A7K' }, paidFor(5000)), {
    ok: true,
    docId: 'LU-261124-113045-A7K',
    paidCentavos: 5000,
  });

  const webhookSrc = fs.readFileSync(path.resolve(__dirname, '../src/payments/webhook.ts'), 'utf8');
  assert.match(webhookSrc, /if \(!paid\.ok\) \{[\s\S]*?logger\.error\(`Paid PayMongo session \$\{sessionId\}[\s\S]*?res\.status\(200\)\.send\('OK'\)/);
});

test('sweepStaleUnpaidOrders isolates per-document transaction failures and expires remaining docs', async () => {
  const { sweepStaleUnpaidOrders } = require('../lib/orders/expire_unpaid');
  const nowMs = Date.parse('2026-11-23T00:00:00.000Z');
  const staleTs = '2026-11-21T00:00:00.000Z';
  const freshTs = '2026-11-22T20:00:00.000Z';

  const docs = [
    { id: 'stale1', ref: { id: 'stale1' }, data: () => ({ paymentStatus: 'AWAITING_PAYMENT', status: 'Pending', timestamp: staleTs }) },
    { id: 'staleFail', ref: { id: 'staleFail' }, data: () => ({ paymentStatus: 'AWAITING_PAYMENT', status: 'Pending', timestamp: staleTs }) },
    { id: 'fresh1', ref: { id: 'fresh1' }, data: () => ({ paymentStatus: 'AWAITING_PAYMENT', status: 'Pending', timestamp: freshTs }) },
    { id: 'stale2', ref: { id: 'stale2' }, data: () => ({ paymentStatus: 'AWAITING_PAYMENT', status: 'Pending', timestamp: staleTs }) },
  ];
  const updated = [];
  const fakeDb = {
    collection: () => ({
      where: () => ({
        limit: () => ({
          get: async () => ({ empty: false, docs }),
        }),
      }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => {
          if (ref.id === 'staleFail') throw new Error('ABORTED: contention');
          const found = docs.find((d) => d.id === ref.id);
          return { exists: Boolean(found), data: () => found?.data() };
        },
        update: (ref, patch) => {
          updated.push({ id: ref.id, patch });
        },
      }),
  };

  const res = await sweepStaleUnpaidOrders(fakeDb, { nowMs, concurrency: 2 });
  assert.equal(res.expired, 2);
  assert.equal(res.failed, 1);
  assert.deepEqual(updated.map((u) => u.id).sort(), ['stale1', 'stale2']);
});

test('isDailyStatsBackfilled enforces bounded TTL on module-level cache', async () => {
  const { isDailyStatsBackfilled, resetBackfillCache } = require('../lib/reporting/daily_stats');
  resetBackfillCache();
  let reads = 0;
  let hasBackfilledAt = false;
  const fakeDb = {
    doc: () => ({
      get: async () => {
        reads++;
        return { exists: hasBackfilledAt, get: (k) => (k === 'backfilledAt' && hasBackfilledAt ? '2026-11-23' : undefined) };
      },
    }),
  };

  try {
    const t0 = 1_000_000;
    assert.equal(await isDailyStatsBackfilled(fakeDb, t0), false);
    assert.equal(reads, 1);
    hasBackfilledAt = true;
    assert.equal(await isDailyStatsBackfilled(fakeDb, t0 + 10_000), true);
    assert.equal(reads, 2);
    assert.equal(await isDailyStatsBackfilled(fakeDb, t0 + 60_000), true);
    assert.equal(reads, 2);
    assert.equal(await isDailyStatsBackfilled(fakeDb, t0 + 10_000 + 5 * 60 * 1000 + 1), true);
    assert.equal(reads, 3);
  } finally {
    resetBackfillCache();
  }
});

test('verify_staff mitigates username timing side-channel and create_checkout maps upstream failures', () => {
  const verifySrc = fs.readFileSync(path.resolve(__dirname, '../src/auth/verify_staff.ts'), 'utf8');
  assert.match(verifySrc, /DUMMY_SCRYPT_HASH/);
  assert.match(verifySrc, /if \(!doc\.exists\)[\s\S]*verifyPasswordAsync\(password,\s*DUMMY_SCRYPT_HASH\)/);
  assert.match(verifySrc, /checkAndRecordWindowFailure\(\s*GLOBAL_PIN_FAIL_KEY/);
  assert.doesNotMatch(verifySrc, /recordWindowFailure\(GLOBAL_PIN_FAIL_KEY/);

  const checkoutSrc = fs.readFileSync(path.resolve(__dirname, '../src/payments/create_checkout.ts'), 'utf8');
  assert.match(checkoutSrc, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(checkoutSrc, /parsePaymongoCheckoutResponse\(json\)/);
});

test('multi-chunk Telegram failure forces a full resend for every chat', async () => {
  const telegramApi = require('../lib/telegram_api');
  const { telegramChatIds } = require('../lib/secrets');
  const origChatIds = telegramChatIds.value;
  telegramChatIds.value = () => 'chatA';
  telegramApi.setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });
  let call = 0;
  telegramApi.setBot({
    async sendMessage() {
      call++;
      if (call === 2) {
        const err = new Error('ETELEGRAM: 500 transient');
        err.response = { statusCode: 500 };
        throw err;
      }
      return { message_id: call };
    },
    async sendPhoto() { return {}; },
  });
  try {
    // Three chunks: the first is delivered, the second fails. No chat has the
    // complete message, so callers must retry the whole delivery for chatA.
    const err = await telegramApi.sendToAll('a'.repeat(8000)).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, 'the second chunk must fail');
    assert.deepEqual(err.deliveredChatIds, []);

    const sentBefore = call;
    await telegramApi.sendToAll('a'.repeat(8000));
    assert.ok(call - sentBefore >= 3, 'retry must resend all chunks rather than skip partial recipients');
  } finally {
    telegramChatIds.value = origChatIds;
    telegramApi.setBot(null);
    telegramApi.setTelegramRetryConfig(null);
  }
});

test('report retries, photo idempotency, cache TTLs and reconciler headroom are guarded', () => {
  const reportSrc = fs.readFileSync(path.resolve(__dirname, '../src/reporting/daily_report.ts'), 'utf8');
  assert.match(reportSrc, /retryCount: 3/);
  assert.match(reportSrc, /scheduledReportDate\(event\.scheduleTime\)/);
  assert.match(reportSrc, /function scheduledReportDate\([\s\S]*phtDateLabel\(parsed\)/);

  const notifSrc = fs.readFileSync(path.resolve(__dirname, '../src/orders/send_notification.ts'), 'utf8');
  const photoPersists = notifSrc.match(/onPhotoSent\(\)\.catch/g) || [];
  assert.strictEqual(photoPersists.length, 2, 'both split and non-split photo paths must persist photoSent');
  assert.match(notifSrc, /const RECONCILE_BATCH_LIMIT = 200/);
  assert.match(notifSrc, /terminal && !hasOrderNotificationState\(notifData\)/);

  const telegramSrc = fs.readFileSync(path.resolve(__dirname, '../src/telegram_api.ts'), 'utf8');
  assert.match(telegramSrc, /botToken !== token/);

  const verifySrc = fs.readFileSync(path.resolve(__dirname, '../src/auth/verify_staff.ts'), 'utf8');
  assert.match(verifySrc, /SEED_CHECK_TTL_MS/);
  assert.match(verifySrc, /staffSeededAt/);
  assert.doesNotMatch(verifySrc, /staffSeeded\s*=/);
  const attemptGate = verifySrc.indexOf('enforceFixedWindowRateLimit(\n    GLOBAL_PIN_ATTEMPT_KEY');
  const pinMatch = verifySrc.indexOf('findMatchingPinAccount(');
  assert.ok(attemptGate >= 0 && attemptGate < pinMatch, 'global PIN attempt budget must be reserved before PIN verification');
});

test('notification reconciler runs serially and keeps structured delivery diagnostics', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/orders/send_notification.ts'), 'utf8');
  assert.match(src, /timeoutSeconds: 540/);
  assert.match(src, /maxInstances: 1/);
  assert.match(src, /priorReconcileAttempts/);
});

test('every checkout session write backfills the original session id for legacy orders', () => {
  const checkoutSrc = fs.readFileSync(path.resolve(__dirname, '../src/payments/create_checkout.ts'), 'utf8');
  const backfills = checkoutSrc.match(/initialCheckoutSessionId: current\.checkoutSessionId/g) || [];
  assert.strictEqual(backfills.length, 2, 'both the reuse and fresh-session branches preserve the prior primary session');
});

test('kiosk board scan budget, staff PIN budget and mirror TTL stay inside their limits', () => {
  const kdsSrc = fs.readFileSync(path.resolve(__dirname, '../src/orders/kds.ts'), 'utf8');
  assert.match(kdsSrc, /export const MAX_SCAN_DOCS = 2000/);
  assert.match(kdsSrc, /if \(scanned >= MAX_SCAN_DOCS\) \{\s*truncated = true;\s*break;/);
  assert.match(kdsSrc, /scanned \+= snapshot\.docs\.length;/);
  assert.match(kdsSrc, /return \{ success: true, orders, scanned, truncated \};/);
  assert.match(kdsSrc, /getActiveOrders stopped after scanning/);
  // The old fixed 3-page cap is what silently dropped active orders.
  assert.doesNotMatch(kdsSrc, /const maxPages = 3/);

  const verifySrc = fs.readFileSync(path.resolve(__dirname, '../src/auth/verify_staff.ts'), 'utf8');
  const attemptMax = Number((verifySrc.match(/const GLOBAL_PIN_ATTEMPT_MAX = (\d+);/) || [])[1]);
  const failMax = Number((verifySrc.match(/const GLOBAL_PIN_FAIL_MAX = (\d+);/) || [])[1]);
  assert.ok(Number.isInteger(attemptMax) && Number.isInteger(failMax), 'both PIN budgets must be numeric literals');
  assert.ok(
    attemptMax >= failMax * 4,
    'the global PIN attempt ceiling must leave headroom for successful sign-ins, or a busy shift locks the team out',
  );

  const derivedSrc = fs.readFileSync(path.resolve(__dirname, '../src/orders/derived.ts'), 'utf8');
  assert.match(derivedSrc, /export const KDS_MIRROR_TTL_MS = 10 \* 24 \* 60 \* 60 \* 1000/);
  const backfillSrc = fs.readFileSync(path.resolve(__dirname, '../scripts/backfill-derived-views.js'), 'utf8');
  assert.match(backfillSrc, /const \{ kdsMirrorDoc, KDS_MIRROR_TTL_MS \} = require\('\.\.\/lib\/orders\/derived'\);/);
  assert.doesNotMatch(
    backfillSrc,
    /const KDS_MIRROR_TTL_MS =/,
    'the backfill script must reuse the trigger TTL so a rerun cannot restore a longer PII retention',
  );
});

test('clientIpFromRequest reports a missing client IP instead of silently sharing one bucket', () => {
  const { clientIpFromRequest: fresh, resetMissingClientIpWarning } = require('../lib/util/security');
  const src = fs.readFileSync(path.resolve(__dirname, '../src/util/security.ts'), 'utf8');
  assert.match(src, /function warnMissingClientIp\(\): void/);
  assert.match(src, /warnMissingClientIp\(\);\n  return '';/);
  resetMissingClientIpWarning();
  assert.equal(fresh({}), '');
  assert.equal(fresh({ headers: { 'x-forwarded-for': '203.0.113.9' } }), '203.0.113.9');
  resetMissingClientIpWarning();
});
