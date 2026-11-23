const test = require('node:test');
const assert = require('node:assert');

const {
  contributionOf, dayDeltas, daysFromOrders, emptyDay, applyToDay,
  dayFromDoc, lifetimeReportFromDays, salesAnalyticsFromDay,
} = require('../lib/reporting/daily_stats');
const { itemKey, emptyChannel, addToChannel, isCountableOrder } = require('../lib/util');

// The order-scanning loop getLifetimeSalesReport ran before dailyStats
// (copied from git 338b627). The new code must reproduce its output.
function legacyReport(orders, dateRange) {
  const zero = () => ({ revenue: 0, count: 0 });
  let totalRevenue = 0; let totalItemsSold = 0; let orderCount = 0;
  const channel = emptyChannel();
  const kiosk = zero(); const staff = zero(); const cash = zero(); const gcash = zero();
  const itemCounts = {}; const dailyRevenue = {}; const dailyOrders = {};
  const add = (b, amount) => { b.revenue += amount; b.count += 1; };
  for (const data of orders) {
    if (!isCountableOrder(data)) continue;
    orderCount += 1;
    const totalAmount = data.totalAmount || 0;
    const dateLabel = data.dateLabel || 'unknown';
    totalRevenue += totalAmount;
    addToChannel(channel, data.type || 'Pickup', totalAmount);
    add(data.entryType === 'Staff' ? staff : kiosk, totalAmount);
    add(String(data.paymentMethod || 'Cash').toLowerCase() === 'gcash' ? gcash : cash, totalAmount);
    dailyRevenue[dateLabel] = (dailyRevenue[dateLabel] || 0) + totalAmount;
    dailyOrders[dateLabel] = (dailyOrders[dateLabel] || 0) + 1;
    for (const item of data.items || []) {
      const name = item.name || 'Unknown';
      const variant = item.variant || '';
      const qty = item.quantity || 1;
      totalItemsSold += qty;
      const key = itemKey(name, variant);
      if (!itemCounts[key]) itemCounts[key] = { name, variant, quantity: 0, revenue: 0 };
      itemCounts[key].quantity += qty;
      itemCounts[key].revenue += (item.price || 0) * qty;
    }
  }
  const topItems = Object.values(itemCounts).sort((a, b) => b.quantity - a.quantity).slice(0, 20)
    .map((item, index) => ({ rank: index + 1, name: itemKey(item.name, item.variant), quantity: item.quantity, revenue: item.revenue }));
  const dailySeries = Object.entries(dailyRevenue)
    .map(([date, revenue]) => ({ date, revenue, orders: dailyOrders[date] || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    success: true, dateRange,
    summary: { totalRevenue, orderCount, averageOrderValue: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0, totalItemsSold },
    breakdown: { channel: { walkIn: channel.walkIn, delivery: channel.delivery, pickup: channel.pickup }, entryType: { kiosk, staff }, paymentMethod: { cash, gcash } },
    topItems, dailySeries,
  };
}

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const MENU = [
  ['Shawarma Wrap', '', 79], ['Shawarma Wrap', 'Spicy', 79], ['Fries & Nachos Overload', 'Barkada', 150],
  ['Fries & Nachos Overload', 'Buddy', 99], ['Milo Craze', 'Oreo', 65], ['Coke 1.5L/Float', '', 49],
  ['Luna Leche Flan', '', 20], ['Burger B1T1', '', 89],
];

function randomOrder(r) {
  // Distinct quantities per line keep top-20 ranking free of ties, which
  // neither the old nor new report promises to order consistently.
  const items = Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
    const [name, variant, price] = pick(r, MENU);
    return { name, variant, price, quantity: 1 + Math.floor(r() * 4) };
  });
  return {
    items,
    totalAmount: items.reduce((s, i) => s + i.price * i.quantity, 0),
    dateLabel: pick(r, ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']),
    type: pick(r, ['Walk-In', 'Delivery', 'Pickup', undefined]),
    entryType: pick(r, ['Kiosk', 'Staff']),
    paymentMethod: pick(r, ['Cash', 'GCash', 'gcash']),
    paymentStatus: pick(r, ['NOT PAID', 'PAID', 'AWAITING_PAYMENT']),
    status: 'Pending',
  };
}

// The next write a real order might see: status moves, payment lands,
// a staff edit to the total, a date correction, or deletion.
function mutate(r, order) {
  const next = { ...order };
  switch (Math.floor(r() * 6)) {
    case 0: next.status = pick(r, ['Preparing', 'Ready', 'Completed']); break;
    case 1: next.status = 'Cancelled'; break;
    case 2: next.paymentStatus = pick(r, ['PAID', 'PAYMENT_FAILED', 'AWAITING_PAYMENT']); break;
    case 3: next.totalAmount = order.totalAmount + 10; break;
    case 4: next.dateLabel = pick(r, ['2026-11-14', '2026-11-15']); break;
    case 5: next.telegramSent = true; break;
  }
  return next;
}

const sortedDays = (m) => [...m.values()]
  .filter((d) => d.orders !== 0)
  .sort((a, b) => a.date.localeCompare(b.date));

/** Day maps compared on stored totals only (zeroed items dropped). */
function normalize(days) {
  return sortedDays(days).map((d) => ({
    ...d,
    items: Object.fromEntries(Object.entries(d.items).filter(([, it]) => it.qty !== 0).sort()),
  }));
}

test('report from day summaries matches the old order scan', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = rng(seed);
    const orders = Array.from({ length: 60 }, () => randomOrder(r));
    const range = { start: '2020-01-01', end: '2026-11-15', isAllTime: true };
    const fromDays = lifetimeReportFromDays(daysFromOrders(orders).values(), range);
    const legacy = legacyReport(orders, range);
    // Top items only compare on quantity order when quantities differ.
    const qty = (x) => x.topItems.map((t) => [t.name, t.quantity, t.revenue]).sort();
    assert.deepStrictEqual(qty(fromDays), qty(legacy), `seed ${seed} topItems`);
    assert.deepStrictEqual(
      fromDays.topItems.map((t) => t.quantity), legacy.topItems.map((t) => t.quantity), `seed ${seed} rank order`);
    delete fromDays.topItems; delete legacy.topItems;
    assert.deepStrictEqual(fromDays, legacy, `seed ${seed}`);
  }
});

test('summing per-write deltas equals recounting the final orders', () => {
  for (let seed = 100; seed <= 140; seed++) {
    const r = rng(seed);
    const live = new Map();
    const stored = new Map(); // what dailyStats would hold after every increment
    const applyDelta = (before, after) => {
      for (const [date, d] of dayDeltas(before, after)) {
        let day = stored.get(date);
        if (!day) stored.set(date, (day = emptyDay(date)));
        day.revenue += d.revenue; day.orders += d.orders; day.itemsSold += d.itemsSold;
        for (const g of ['channel', 'entryType', 'paymentMethod']) {
          for (const [k, b] of Object.entries(d[g])) { day[g][k].revenue += b.revenue; day[g][k].count += b.count; }
        }
        for (const [k, it] of Object.entries(d.items)) {
          const slot = day.items[k] || (day.items[k] = { name: it.name, variant: it.variant, qty: 0, revenue: 0 });
          slot.qty += it.qty; slot.revenue += it.revenue;
        }
      }
    };
    for (let step = 0; step < 300; step++) {
      const ids = [...live.keys()];
      if (!ids.length || r() < 0.3) {
        const id = `o${step}`; const o = randomOrder(r);
        applyDelta(undefined, o); live.set(id, o);
      } else if (r() < 0.05) {
        const id = pick(r, ids); applyDelta(live.get(id), undefined); live.delete(id);
      } else {
        const id = pick(r, ids); const next = mutate(r, live.get(id));
        applyDelta(live.get(id), next); live.set(id, next);
      }
    }
    assert.deepStrictEqual(normalize(stored), normalize(daysFromOrders(live.values())), `seed ${seed}`);
  }
});

test('status-only and bookkeeping writes produce no stats write', () => {
  const o = { ...randomOrder(rng(7)), paymentMethod: 'Cash', status: 'Pending' };
  assert.strictEqual(dayDeltas(o, { ...o, status: 'Preparing' }).size, 0);
  assert.strictEqual(dayDeltas(o, { ...o, telegramSent: true }).size, 0);
  assert.strictEqual(dayDeltas(o, { ...o, status: 'Cancelled' }).size, 1);
});

test('a date correction moves the order between days', () => {
  const o = { ...randomOrder(rng(9)), paymentMethod: 'Cash', dateLabel: '2026-11-14' };
  const d = dayDeltas(o, { ...o, dateLabel: '2026-11-15' });
  assert.deepStrictEqual([...d.keys()].sort(), ['2026-11-14', '2026-11-15']);
  assert.strictEqual(d.get('2026-11-14').orders, -1);
  assert.strictEqual(d.get('2026-11-15').orders, 1);
});

test('unpaid GCash orders do not count until payment lands', () => {
  const o = { ...randomOrder(rng(11)), paymentMethod: 'GCash', paymentStatus: 'AWAITING_PAYMENT' };
  assert.strictEqual(contributionOf(o), null);
  const d = dayDeltas(o, { ...o, paymentStatus: 'PAID' });
  assert.strictEqual([...d.values()][0].paymentMethod.gcash.count, 1);
});

test('stored docs round-trip and tolerate missing fields', () => {
  const day = emptyDay('2026-11-15');
  applyToDay(day, contributionOf({ ...randomOrder(rng(3)), paymentMethod: 'Cash', items: [{ name: 'A/B', price: 10, quantity: 2 }], totalAmount: 20 }), 1);
  assert.deepStrictEqual(dayFromDoc('2026-11-15', JSON.parse(JSON.stringify(day))), day);
  assert.ok(day.items['A∕B'], 'slash in item name is stored safely');
  const sparse = dayFromDoc('2026-11-15', { revenue: 5, orders: 1 });
  assert.strictEqual(sparse.channel.pickup.count, 0);
  assert.strictEqual(sparse.date, '2026-11-15');
});

test('salesAnalyticsFromDay matches scanning today orders', () => {
  const dateLabel = '2026-11-15';
  const r = rng(42);
  const orders = Array.from({ length: 30 }, () => ({ ...randomOrder(r), dateLabel }));
  const day = daysFromOrders(orders).get(dateLabel) || emptyDay(dateLabel);
  const fromDay = salesAnalyticsFromDay(dateLabel, day);

  let totalRevenue = 0; let totalItemsSold = 0; let orderCount = 0;
  const channel = emptyChannel();
  const itemCounts = {};
  for (const data of orders) {
    if (!isCountableOrder(data)) continue;
    orderCount += 1;
    totalRevenue += data.totalAmount || 0;
    addToChannel(channel, data.type || 'Pickup', data.totalAmount || 0);
    for (const item of data.items || []) {
      const key = itemKey(item.name || 'Unknown', item.variant);
      const qty = Number(item.quantity || item.qty) || 1;
      totalItemsSold += qty;
      itemCounts[key] = (itemCounts[key] || 0) + qty;
    }
  }
  const topItems = Object.entries(itemCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const expected = {
    success: true,
    dateLabel,
    totalRevenue,
    totalItemsSold,
    orderCount,
    averageOrderValue: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
    breakdown: {
      walkIn: channel.walkIn,
      delivery: channel.delivery,
      pickup: channel.pickup,
    },
    topItems,
  };
  assert.strictEqual(fromDay.totalRevenue, expected.totalRevenue);
  assert.strictEqual(fromDay.totalItemsSold, expected.totalItemsSold);
  assert.strictEqual(fromDay.orderCount, expected.orderCount);
  assert.strictEqual(fromDay.averageOrderValue, expected.averageOrderValue);
  assert.deepStrictEqual(fromDay.breakdown, expected.breakdown);
  assert.deepStrictEqual(fromDay.topItems.map((t) => t.count), expected.topItems.map((t) => t.count));
});

test('isDailyStatsBackfilled caches true after first observation and does not cache false', async () => {
  const { isDailyStatsBackfilled, resetBackfillCache } = require('../lib/reporting/daily_stats');
  resetBackfillCache();
  let reads = 0;
  let backfilledAt = null;
  const fakeDb = {
    doc() {
      return {
        async get() {
          reads += 1;
          return {
            exists: backfilledAt !== null,
            get(field) {
              return field === 'backfilledAt' ? backfilledAt : undefined;
            },
          };
        },
      };
    },
  };

  assert.strictEqual(await isDailyStatsBackfilled(fakeDb), false);
  assert.strictEqual(reads, 1);
  assert.strictEqual(await isDailyStatsBackfilled(fakeDb), false);
  assert.strictEqual(reads, 2, 'false must not be permanently cached');

  backfilledAt = '2026-11-21T00:00:00.000Z';
  assert.strictEqual(await isDailyStatsBackfilled(fakeDb, 10_000), true);
  assert.strictEqual(reads, 3);
  assert.strictEqual(await isDailyStatsBackfilled(fakeDb, 10_000 + 60_000), true);
  assert.strictEqual(reads, 3, 'true must be served from module cache within TTL');

  const { BACKFILL_CACHE_TTL_MS } = require('../lib/reporting/daily_stats');
  backfilledAt = null;
  assert.strictEqual(await isDailyStatsBackfilled(fakeDb, 10_000 + BACKFILL_CACHE_TTL_MS + 1), false);
  assert.strictEqual(reads, 4, 'cache must expire after BACKFILL_CACHE_TTL_MS and observe reset');

  resetBackfillCache();
});
