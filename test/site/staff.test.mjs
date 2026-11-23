import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kds = await import('../../app/src/staff/kds-data.ts');
const report = await import('../../app/src/staff/report-data.ts');
const { staffUsernameFor } = await import('../../app/src/kiosk/staff-hint.ts');
const { esc, icon, num, int } = await import('../../app/src/staff/ui.ts');
const { JSDOM } = await import('jsdom');
const { readPasswordCredentials } = await import('../../app/src/staff/login-credentials.ts');

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

test('staff login reads password-manager autofill values without input events', () => {
  const dom = new JSDOM('<form><input name="user"><input name="pass"></form>');
  const form = dom.window.document.querySelector('form');
  form.elements.namedItem('user').value = 'ana';
  form.elements.namedItem('pass').value = 'secret';
  assert.deepEqual(readPasswordCredentials(form), { username: 'ana', password: 'secret' });
  dom.window.close();
});

test('staff service worker serves immutable assets cache-first and navigations network-first', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sw = readFileSync(join(root, 'app/public/staff/sw.js'), 'utf8');
  assert.match(sw, /const immutable\s*=.*\/_astro\//);
  assert.match(sw, /const fontAsset\s*=.*\/kiosk\/fonts\//);
  assert.match(sw, /caches\.open\(CACHE\)\.then\(\(c\) => c\.match\(req\)\)/);
  assert.match(sw, /if \(immutable\)\s*\{[\s\S]*matchCache\(req\)/);
  assert.match(sw, /const MAX_NAVIGATION_ENTRIES = 8/);
  assert.match(sw, /key\.mode === 'navigate'/);
  assert.match(sw, /navigationKeys\.length > MAX_NAVIGATION_ENTRIES/);
});

test('kds delayed badge keeps INK contrast on elapsed-time ticks and dashboard handles non-admin badge', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');
  assert.match(kdsSrc, /ageEl\.style\.color\s*=\s*delayed\s*\?\s*INK\s*:\s*elapsedColor\(ts,\s*now\)/);

  const dashSrc = readFileSync(join(root, 'app/src/staff/dashboard.ts'), 'utf8');
  assert.match(dashSrc, /staff\?\.isAdmin\s*\?\s*'ADMIN DASHBOARD'\s*:\s*'STAFF DASHBOARD'/);
  assert.match(dashSrc, /if\s*\(sheetLoading\s*\|\|\s*!getStaff\(\)\)\s*return;/);
  assert.match(dashSrc, /if\s*\(disposed\s*\|\|\s*seq\s*!==\s*fetchSeq\s*\|\|\s*!getStaff\(\)\)\s*return;/);

  const checkoutSrc = readFileSync(join(root, 'app/src/pages/kiosk/checkout.astro'), 'utf8');
  assert.match(checkoutSrc, /isWalkIn:\s*draft\.orderType\s*===\s*'Walk-In'/);

  // KDS updateStatus clears busy state before haltOnAuthError, tears down background timers/listeners, and uses targeted renderBoard() in finally
  assert.match(kdsSrc, /function haltOnAuthError\(message: string\)\s*\{\s*authHalted = true;[\s\S]*stopBackgroundActivity\(\);/);
  assert.match(kdsSrc, /function stopBackgroundActivity\(\)[\s\S]*clearInterval\(clock\);[\s\S]*detachBackgroundListeners\?\.\(\);/);
  assert.match(kdsSrc, /if \(err && isAuthCode\(err\.code\)\)[\s\S]*updating\.delete\(orderId\);[\s\S]*haltOnAuthError\(/);
  assert.match(kdsSrc, /updating\.delete\(orderId\);\s*\n\s*if \(!disposed && !authHalted\) renderBoard\(\);/);
  assert.match(kdsSrc, /const onOnline = \(\) => \{[\s\S]*startLiveListener\(\)/);
  assert.match(kdsSrc, /await Promise\.all\(\[firebaseDb\(\), import\('firebase\/firestore'\)\]\);[\s\S]*if \(disposed \|\| authHalted\) return;[\s\S]*unsub\?\.\(\);/);
  assert.match(kdsSrc, /await startLiveListener\(\);\s*if \(disposed \|\| authHalted\) return;\s*lookbackTimer/);

  // Staff login returns cleanup wired by gate.ts
  const loginSrc = readFileSync(join(root, 'app/src/staff/login.ts'), 'utf8');
  assert.match(loginSrc, /export function mountLogin\(root: HTMLElement\): \(\) => void/);
  assert.match(loginSrc, /readPasswordCredentials\(e\.target as HTMLFormElement\)/);
  assert.match(loginSrc, /removeEventListener\('keydown',\s*onKey\)/);
  const gateSrc = readFileSync(join(root, 'app/src/staff/gate.ts'), 'utf8');
  assert.match(kdsSrc, /board\.querySelector<HTMLButtonElement>\([^\n]*data-tab=\"\$\{next\}\"[^\n]*\)\?\.focus\(\)/);
  assert.match(kdsSrc, /event\.key === 'ArrowRight'[\s\S]*event\.key === 'ArrowLeft'[\s\S]*event\.key === 'Home'[\s\S]*event\.key === 'End'/);
  assert.match(kdsSrc, /if \(authHalted \|\| !getStaff\(\)\) return;/);
  assert.match(gateSrc, /else dispose = mountLogin\(root\);/);
});

test('kds skips the board rebuild on metadata-only snapshots and stops after an auth halt', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');

  // includeMetadataChanges fires on cache/server flips; rebuilding every card for
  // those steals scroll position, so only the feed indicator is redrawn.
  assert.match(kdsSrc, /const unchanged = isLive && nextSignature === liveSignature && polled\.length === 0;/);
  assert.match(kdsSrc, /if \(unchanged\) \{\s*renderBar\(\);\s*renderBanner\(\);\s*return;\s*\}/);
  assert.match(kdsSrc, /let liveSignature = '';/);
  assert.match(kdsSrc, /liveSignature = '';/);

  // updateStatus must read the module-level auth flag, not a shadowing local.
  assert.strictEqual(
    kdsSrc.match(/authHalted = false;/g)?.length,
    1,
    'only the module-level authHalted may be declared; updateStatus must not shadow it',
  );
  assert.match(kdsSrc, /if \(disposed \|\| authHalted \|\| updating\.has\(orderId\)\) return;/);
});

test('kiosk menu sheet and GCash page recover from a second tap and a failed retry', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const menuSrc = readFileSync(join(root, 'app/src/pages/kiosk/menu.astro'), 'utf8');
  // showModal() on an already-open dialog throws InvalidStateError.
  assert.match(menuSrc, /if \(sheet\.open\) return Promise\.resolve\(\);/);
  assert.match(menuSrc, /sheet\.showModal\(\);/);

  const gcashSrc = readFileSync(join(root, 'app/src/pages/kiosk/gcash.astro'), 'utf8');
  // A retry must drop the previous session before asking for a new one…
  assert.match(gcashSrc, /checkoutUrl = null;\s*sessionId = null;\s*setVerifyError\(null\);/);
  // …and clear the stale "session is not ready" complaint once it arrives.
  assert.match(gcashSrc, /if \(sessionId\) setVerifyError\(null\);/);
});
