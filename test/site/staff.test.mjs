import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kds = await import('../../app/src/staff/kds-data.ts');
const report = await import('../../app/src/staff/report-data.ts');
const { staffUsernameFor } = await import('../../app/src/kiosk/staff-hint.ts');
const { esc, icon, num, int } = await import('../../app/src/staff/ui.ts');

/// These cases were ported from the Flutter staff screens (removed in the
/// cutover), so the kitchen and report rules stay the same.

test('month axis labels match the Flutter report', () => {
  assert.equal(report.formatMonthAxisLabel('2026-11'), "N '26");
  assert.equal(report.formatMonthAxisLabel('2025-01'), "J '25");
  assert.equal(report.formatMonthAxisLabel('unknown'), 'unknown');
  assert.equal(report.formatMonthAxisLabel('2026-13'), '2026-13');
});

test('report numbers shorten as _fmt and _shortFmt do', () => {
  assert.equal(report.fmt(999), '999');
  assert.equal(report.fmt(1202), '1.2K');
  assert.equal(report.fmt(2_500_000), '2.5M');
  assert.equal(report.shortFmt(2_500_000), '2500.0K');
});

test('date presets send the range _computeStartDate/_computeEndDate send', () => {
  // Wednesday 2026-11-18 in the Philippines.
  const today = new Date(Date.UTC(2026, 10, 18));
  assert.equal(report.presetRange('allTime', null, today), null);
  assert.deepEqual(report.presetRange('today', null, today), { startDate: '2026-11-18', endDate: '2026-11-18' });
  assert.deepEqual(report.presetRange('thisWeek', null, today), { startDate: '2026-11-16', endDate: '2026-11-18' });
  assert.deepEqual(report.presetRange('thisMonth', null, today), { startDate: '2026-11-01', endDate: '2026-11-18' });
  assert.deepEqual(report.presetRange('thisYear', null, today), { startDate: '2026-01-01', endDate: '2026-11-18' });
  assert.deepEqual(report.presetRange('custom', { start: '2026-10-01', end: '2026-10-31' }, today), { startDate: '2026-10-01', endDate: '2026-10-31' });
  // A Monday starts its own week; a Sunday belongs to the week before.
  assert.equal(report.presetRange('thisWeek', null, new Date(Date.UTC(2026, 10, 16)))?.startDate, '2026-11-16');
  assert.equal(report.presetRange('thisWeek', null, new Date(Date.UTC(2026, 10, 22)))?.startDate, '2026-11-16');
});

test('staff uids map to usernames as the Flutter session did', () => {
  assert.equal(staffUsernameFor('staff_anna'), 'anna');
  assert.equal(staffUsernameFor('staff_'), null);
  assert.equal(staffUsernameFor('anon123'), null);
});

const orders = [
  { id: 'a', orderNumber: 'LU-001', type: 'Delivery', customerName: 'Ana Reyes', timestamp: '2026-11-15T01:00:00.000Z', items: [{ name: 'S3 – Shawarma Rice', quantity: 2 }] },
  { id: 'b', orderNumber: 'LU-002', type: 'Pickup', customerName: 'Ben Cruz', timestamp: '2026-11-15T02:00:00.000Z', items: [{ name: 'Milo Craze', qty: 1 }] },
  { id: 'c', orderNumber: 'LU-003', type: 'Walk-In', entryType: 'Staff', customerName: 'Carla Lim', timestamp: '2026-11-15T03:00:00.000Z', items: [] },
];

test('kitchen filters and search', () => {
  assert.deepEqual(kds.filterOrders(orders, 'Delivery', '').map((o) => o.id), ['a']);
  assert.deepEqual(kds.filterOrders(orders, 'Walk-In', '').map((o) => o.id), ['c']);
  assert.deepEqual(kds.filterOrders(orders, 'ALL', 'milo').map((o) => o.id), ['b']);
  assert.deepEqual(kds.filterOrders(orders, 'ALL', ' lu-003 ').map((o) => o.id), ['c']);
});

test('live orders win over polled ones, newest first', () => {
  const merged = kds.mergeKdsOrders([{ ...orders[0], status: 'Preparing' }], orders);
  assert.deepEqual(merged.map((o) => o.id), ['c', 'b', 'a']);
  assert.equal(merged[2].status, 'Preparing');
});

test('mirror docs become callable-shaped orders', () => {
  const o = kds.kdsOrderFromDoc('x1', { ts: 'T', status: 'Pending' }, () => new Date('2026-11-15T00:00:00.000Z'));
  assert.deepEqual(o, { id: 'x1', status: 'Pending', timestamp: '2026-11-15T00:00:00.000Z' });
});

test('ticket age, colour and the ten-minute delay flag', () => {
  const t0 = Date.parse('2026-11-15T01:00:00.000Z');
  const ts = '2026-11-15T01:00:00.000Z';
  assert.equal(kds.formatElapsed(ts, t0 + 30_000), 'Just now');
  assert.equal(kds.formatElapsed(ts, t0 + 9 * 60_000), '9m ago');
  assert.equal(kds.formatElapsed(ts, t0 + 75 * 60_000), '1h 15m ago');
  assert.equal(kds.formatElapsed('nope', t0), '');
  assert.equal(kds.elapsedColor(ts, t0 + 8 * 60_000), '#B45309');
  assert.equal(kds.elapsedColor(ts, t0 + 15 * 60_000), '#B3261E');
  assert.equal(kds.isDelayed({ timestamp: ts }, t0 + 10 * 60_000), true);
  assert.equal(kds.isDelayed({ timestamp: ts, status: 'Preparing' }, t0 + 60 * 60_000), false);
  assert.equal(kds.isClosedKdsStatus('Completed'), true);
  assert.equal(kds.isClosedKdsStatus('Ready'), false);
});

test('rider dispatch note carries the order, contact and map link', () => {
  const note = kds.dispatchNote({ ...orders[0], customerPhone: '09171234567', customerAddress: 'Purok 5', total: 263, lat: 9.02, lng: 125.51 });
  assert.match(note, /^🛵 \*LUNA BITES & DELIGHTS — #LU-001\*/);
  assert.match(note, /📞 Phone: 09171234567/);
  assert.match(note, /destination=9\.02,125\.51/);
  assert.match(note, / {2}• 2x S3 – Shawarma Rice/);
});

test('esc escapes HTML entities and handles nullish and numeric inputs', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc("Luna's Pork Sisig"), 'Luna&#39;s Pork Sisig');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('ui helpers format icons and finite numbers cleanly', () => {
  assert.match(icon('refresh_rounded', 'spin'), /^<span class="icon spin" aria-hidden="true">.*<\/span>$/);
  assert.equal(num(12.5), 12.5);
  assert.equal(num(NaN), 0);
  assert.equal(num('12'), 0);
  assert.equal(int(199.9), 199);
});

test('staff service worker serves immutable assets cache-first and navigations network-first', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sw = readFileSync(join(root, 'app/public/staff/sw.js'), 'utf8');
  assert.match(sw, /const immutable\s*=.*\/_astro\/.*\/kiosk\/fonts\//);
  assert.match(sw, /if \(immutable\)\s*\{[\s\S]*caches\.match\(req\)/);
  assert.match(sw, /req\.mode === 'navigate'/);
});
