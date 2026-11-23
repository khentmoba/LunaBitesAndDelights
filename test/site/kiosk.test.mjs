import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// cart.ts keeps its lines in sessionStorage and announces changes on window.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = new EventTarget();

const { resolvePicks, displayPrice } = await import('../../app/src/kiosk/preselect.ts');
const { cart } = await import('../../app/src/kiosk/cart.ts');
const order = await import('../../app/src/kiosk/order.ts');
const { isPaymentUrl } = await import('../../app/src/kiosk/payment-host.ts');
const { validReceipt } = await import('../../app/src/kiosk/handoff.ts');

test('receipt handoff rejects corrupt shapes so the page never blanks out', () => {
  const good = {
    orderNumber: 'LU-1', customerName: 'Ana', customerAddress: 'Purok 5', customerPhone: '09171234567',
    timeStr: '2026-11-24 10:00', total: 99, orderType: 'Delivery', isWalkIn: false, telegramSent: true,
    items: [{ name: 'Shawarma Wrap', variant: 'Solo', price: 99, quantity: 1 }],
  };
  assert.equal(validReceipt(good), true);
  for (const bad of [
    null, {}, { ...good, items: null }, { ...good, items: [{}] },
    { ...good, total: '99' }, { ...good, orderType: 'Bogus' },
    { ...good, items: [{ name: 'x', price: Number.NaN, quantity: 1 }] },
  ]) {
    assert.equal(validReceipt(bad), false, JSON.stringify(bad));
  }
});

test('geocode keeps a deadline on browsers without AbortSignal.any/timeout', () => {
  const src = readFileSync(new URL('../../app/src/kiosk/geo.ts', import.meta.url), 'utf8');
  assert.match(src, /typeof AbortSignal\.timeout === 'function'/);
  assert.match(src, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
  assert.doesNotMatch(src, /signal \?\? timeout/);
});

test('GCash checkout failure offers retry without discarding the pending order', () => {
  const src = readFileSync(new URL('../../app/src/pages/kiosk/gcash.astro', import.meta.url), 'utf8');
  assert.match(src, /data-retry[\s\S]*?RETRY CHECKOUT/);
  assert.match(src, /\$\('\[data-retry\]'\)\.addEventListener\('click', \(\) => void start\(pending\)\)/);
});

test('opening the map preserves typed delivery addresses until the shopper pins a location', () => {
  const src = readFileSync(new URL('../../app/src/pages/kiosk/map.astro', import.meta.url), 'utf8');
  assert.match(src, /if \(draft\?\.pinned \|\| draft\?\.address\?\.trim\(\)\) return;/);
  assert.match(src, /map\.addListener\('center_changed', \(\) => \{\s*if \(Date\.now\(\) < ignoreIdleUntil\) return;/);
  assert.match(src, /if \(!map \|\| Date\.now\(\) < ignoreIdleUntil \|\| !userInteracted\) return;/);
  assert.match(src, /!draft\?\.pinned && !userInteracted/);
});

test('a rejected Google Maps key shows our notice instead of the map error overlay', () => {
  const src = readFileSync(new URL('../../app/src/pages/kiosk/map.astro', import.meta.url), 'utf8');
  assert.match(src, /gm_authFailure/);
  assert.match(src, /\.catch\(degrade\)/);
  assert.match(src, /function degrade\(\) \{\s*mapEl\.innerHTML = '';/);
});

test('GCash cancellation clears the pending handoff, not just the draft flag', () => {
  const src = readFileSync(new URL('../../app/src/pages/kiosk/gcash.astro', import.meta.url), 'utf8');
  assert.match(src, /function cancel\(\)[\s\S]*?save\(PENDING, null\)/);
});

/// These cases were ported from the Flutter kiosk's tests (removed in the
/// cutover), so the rules customers relied on stay the same.

test('storefront picks resolve as the Flutter kiosk resolved them', () => {
  const r = resolvePicks(['s1#Solo', 's8#Barkada (3–5 pax)', 'b1', 'f4', 'f4', '@drinks', 'nope', 'header_coolers', 's1#Made up']);
  assert.deepEqual(r.ready.map((c) => `${c.name}|${c.variant}|${c.price}`), [
    'Shawarma Wrap|Solo|60',
    'Nachos & Fries Overload|Barkada (3–5 pax)|150',
    'Burger Patty||55',
  ]);
  assert.deepEqual(r.needsChoice.map((m) => m.id), ['f4', 's1']);
  assert.equal(r.sectionId, 'drinks');
  assert.equal(r.sectionPick, true);
  assert.equal(resolvePicks(['b1']).sectionPick, false);
  assert.equal(resolvePicks(Array.from({ length: 100 }, () => 'b1')).ready.length, 80, 'at most 80 picks are read');
});

test('a card shows its cheapest variant', () => {
  assert.equal(displayPrice({ price: 99, variants: [{ label: 'a', price: 70 }, { label: 'b', price: 60 }] }), 60);
  assert.equal(displayPrice({ price: 55, variants: [] }), 55);
  assert.equal(displayPrice({ price: null, variants: [{ label: 'a', price: 0 }] }), 0);
});

test('the cart merges same name and variant, and counts and totals lines', () => {
  cart.clear();
  const line = { id: 'a', name: 'Shawarma Wrap', emoji: '', imageUrl: '', variant: 'Solo', price: 60, quantity: 1 };
  cart.add(line);
  cart.add({ ...line, id: 'b', quantity: 2 });
  cart.add({ ...line, id: 'c', variant: 'Duo', price: 110 });
  assert.equal(cart.items().length, 2);
  assert.equal(cart.totalCount(), 4);
  assert.equal(cart.totalPrice(), 60 * 3 + 110);
  cart.decrement('c');
  assert.equal(cart.items().length, 1, 'decrementing the last one removes the line');
  cart.increment('a');
  assert.equal(cart.totalCount(), 4);
  assert.deepEqual(JSON.parse(sessionStorage.getItem('luna.cart')).map((i) => i.quantity), [4], 'the cart persists for the next page');
  cart.remove('a');
  assert.equal(cart.totalCount(), 0);
});

test('new orders carry only the statuses firestore.rules allows', () => {
  assert.deepEqual(order.statusesFor(false, 'Cash'), { status: 'Pending', paymentStatus: 'NOT PAID', entryType: 'Kiosk' });
  assert.deepEqual(order.statusesFor(false, 'GCash'), { status: 'Pending', paymentStatus: 'AWAITING_PAYMENT', entryType: 'Kiosk' });
  assert.deepEqual(order.statusesFor(true, 'GCash'), { status: 'Pending', paymentStatus: 'PAID', entryType: 'Staff' });
  assert.match(order.rejectionFor('', 1), /enter a name/);
  assert.match(order.rejectionFor('x'.repeat(101), 1), /too long/);
  assert.match(order.rejectionFor('Ana', 51), /up to 50/);
  assert.equal(order.rejectionFor('x'.repeat(100), 50), null);
});

test('names and PH mobile numbers validate as the Flutter kiosk did', () => {
  assert.equal(order.validateName('  '), 'Name is required');
  assert.equal(order.validateName('x'.repeat(101)), 'Name too long');
  assert.equal(order.validateName('Ana Reyes'), null);
  for (const ok of ['09171234567', '0917 123 4567', '0917-123-4567', '+639171234567', '639171234567']) assert.equal(order.validatePhone(ok), null, ok);
  assert.equal(order.validatePhone(''), 'Phone is required');
  for (const bad of ['0817123456', '0917123456', '091712345678', '+6309171234567']) assert.equal(order.validatePhone(bad), 'Enter a valid PH mobile number', bad);
});

test('order numbers and date labels use Philippine time', () => {
  const at = new Date('2026-11-15T17:04:05Z'); // 01:04:05 on the 16th in Manila
  assert.equal(order.phtDateLabel(at), '2026-11-16');
  assert.equal(order.orderNumberFor(at, ''), 'LU-261116-010405');
  assert.match(order.orderNumberFor(at), /^LU-261116-010405-[A-Z0-9]{3}$/);
  assert.equal(order.phtDateLabel(new Date('2026-12-31T15:59:59Z')), '2026-12-31');
});

test('delivery distance is measured from the nearer kitchen', () => {
  assert.equal(order.deliveryDistance(order.STORE.lat, order.STORE.lng), 0);
  assert.equal(order.deliveryDistance(order.BASE2.lat, order.BASE2.lng), 0);
  const between = order.haversine(order.STORE.lat, order.STORE.lng, order.BASE2.lat, order.BASE2.lng);
  assert.ok(between > 11 && between < 12, `kitchens are ${between} km apart`);
  assert.ok(Math.abs(order.deliveryDistance(9.03, 125.52) - order.haversine(order.STORE.lat, order.STORE.lng, 9.03, 125.52)) < 1e-9);
});

test('the saved order and its notification match the Flutter payloads', () => {
  const o = {
    orderId: 'LU-261116-010405', items: [{ name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 2 }], totalAmount: 120,
    timestamp: new Date(), dateLabel: '2026-11-16', type: 'Delivery', entryType: 'Kiosk', customerName: 'Ana', customerPhone: '09171234567',
    customerAddress: 'Purok 5', lat: 9.02, lng: 125.51, deliveryFee: 0, totalDistance: 0.4, paymentMethod: 'Cash', paymentStatus: 'NOT PAID', status: 'Pending',
  };
  const f = order.orderFields(o);
  assert.equal(f.items[0].total, 120);
  assert.equal(f.checkoutSessionId, null);
  assert.equal(f.paymongoPaymentId, null);
  assert.equal('itemsCount' in f, false);
  assert.equal('timestamp' in f, false);
  const n = order.notificationFor(o, '2026-11-16  01:04', 'doc1');
  assert.equal(n.orderDocId, 'doc1');
  assert.equal(n.orderNumber, o.orderId);
  assert.equal(n.total, 120);
  assert.equal(n.orderType, 'Delivery');
});

test('GCash only opens https PayMongo-family checkout links', () => {
  assert.equal(isPaymentUrl('https://checkout.paymongo.com/cs_123'), true);
  assert.equal(isPaymentUrl('https://paymongo.com/x'), true);
  assert.equal(isPaymentUrl('https://pay.maya.ph/x'), true);
  assert.equal(isPaymentUrl('http://checkout.paymongo.com/cs_123'), false);
  assert.equal(isPaymentUrl('https://paymongo.com.evil.example/x'), false);
  assert.equal(isPaymentUrl('https://evilpaymongo.com/x'), false);
  assert.equal(isPaymentUrl('javascript:alert(1)'), false);
  assert.equal(isPaymentUrl('not a url'), false);
});
