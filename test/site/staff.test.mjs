import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import vm from 'node:vm';

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

test('live orders win over polled ones by default, and polledWins lets manual sync override stale cache', () => {
  const merged = kds.mergeKdsOrders([{ ...orders[0], status: 'Preparing' }], orders);
  assert.deepEqual(merged.map((o) => o.id), ['c', 'b', 'a']);
  assert.equal(merged[2].status, 'Preparing');
  // Manual sync after a cached snapshot must let fresh polled data win.
  const synced = kds.mergeKdsOrders([{ ...orders[0], status: 'Pending' }], [{ ...orders[0], status: 'Ready' }], true);
  assert.equal(synced[0].status, 'Ready');
  // With no live snapshot there is nothing to prefer, so polling is the board.
  assert.deepEqual(kds.mergeKdsOrders([], [{ ...orders[0], status: 'Ready' }]).map((o) => o.status), ['Ready']);

  // Stale cached snapshot must not clobber a fresher manual sync; server snapshot must replace it.
  assert.equal(kds.shouldSkipUnchangedLiveSnapshot(true, 'sig', 'sig', 1, true, true), true);
  assert.equal(kds.shouldSkipUnchangedLiveSnapshot(true, 'sig', 'sig', 1, false, true), false);
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

test('staff service worker serves immutable assets cache-first and prunes navigation cache entries', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sw = readFileSync(join(root, 'app/public/staff/sw.js'), 'utf8');
  assert.match(sw, /const immutable\s*=.*\/_astro\//);
  assert.match(sw, /const fontAsset\s*=.*\/kiosk\/fonts\//);
  assert.match(sw, /caches\.open\(CACHE\)\.then\(\(c\) => c\.match\(req\)\)/);
  assert.match(sw, /if \(immutable\)\s*\{[\s\S]*matchCache\(req\)/);
  assert.match(sw, /const MAX_NAVIGATION_ENTRIES = 8/);

  // Execute sw.js with a Cache API mock whose keys() return mode: 'cors'
  // (matching the real browser Cache API, where stored Requests never have mode === 'navigate').
  const store = new Map();
  const cache = {
    async put(req, res) {
      store.set(req.url, res);
    },
    async match(req) {
      return store.get(req.url);
    },
    async keys() {
      return [...store.keys()].map((url) => ({ url, mode: 'cors' }));
    },
    async delete(req) {
      return store.delete(req.url);
    },
  };
  let fetchHandler = null;
  let activateHandler = null;
  const deletedCaches = [];
  const ctx = vm.createContext({
    URL,
    Response,
    location: { origin: 'https://lunabitesanddelights.web.app' },
    self: {
      addEventListener(type, fn) {
        if (type === 'fetch') fetchHandler = fn;
        if (type === 'activate') activateHandler = fn;
      },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      async open() { return cache; },
      async keys() { return ['luna-staff-v3', 'luna-staff-v4']; },
      async delete(key) { deletedCaches.push(key); return true; },
    },
    async fetch(req) {
      if (req.url.includes('partial')) {
        return { ok: true, status: 206, redirected: false, clone() { return { ok: true, status: 206, redirected: false }; } };
      }
      if (req.url.includes('redirected')) {
        return { ok: true, status: 200, redirected: true, clone() { return { ok: true, status: 200, redirected: true }; } };
      }
      return { ok: true, status: 200, redirected: false, clone() { return { ok: true, status: 200, redirected: false }; } };
    },
  });
  vm.runInContext(sw, ctx);
  assert.ok(fetchHandler, 'sw.js should register a fetch listener');
  assert.ok(activateHandler, 'sw.js should register an activate listener');

  const activateWaits = [];
  activateHandler({ waitUntil(p) { activateWaits.push(p); } });
  await Promise.all(activateWaits);
  assert.deepEqual(deletedCaches, ['luna-staff-v3'], 'activate should purge previous staff cache versions');

  // Seed non-navigation assets that must never be evicted by navigation pruning.
  store.set('https://lunabitesanddelights.web.app/_astro/app.js', { ok: true });
  store.set('https://lunabitesanddelights.web.app/kiosk/fonts/inter.woff2', { ok: true });
  store.set('https://lunabitesanddelights.web.app/kiosk/images/luna_logo.webp', { ok: true });

  for (let i = 0; i < 10; i++) {
    const waits = [];
    let responsePromise = null;
    fetchHandler({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: `https://lunabitesanddelights.web.app/staff/page-${i}`,
      },
      respondWith(p) { responsePromise = p; },
      waitUntil(p) { waits.push(p); },
    });
    await responsePromise;
    await Promise.all(waits);
  }

  const cachedUrls = [...store.keys()];
  const navUrls = cachedUrls.filter((u) => u.includes('/staff/page-'));
  assert.equal(navUrls.length, 8, 'navigation cache should be pruned to MAX_NAVIGATION_ENTRIES');
  assert.equal(navUrls[0], 'https://lunabitesanddelights.web.app/staff/page-2');
  assert.equal(navUrls[7], 'https://lunabitesanddelights.web.app/staff/page-9');
  assert.ok(store.has('https://lunabitesanddelights.web.app/_astro/app.js'));
  assert.ok(store.has('https://lunabitesanddelights.web.app/kiosk/fonts/inter.woff2'));
  assert.ok(store.has('https://lunabitesanddelights.web.app/kiosk/images/luna_logo.webp'));

  // 206 Partial Content responses are ok=true but Cache.put() rejects them;
  // verify the worker skips caching them.
  const partialWaits = [];
  let partialRes = null;
  fetchHandler({
    request: {
      method: 'GET',
      mode: 'cors',
      url: 'https://lunabitesanddelights.web.app/_astro/partial.js',
    },
    respondWith(p) { partialRes = p; },
    waitUntil(p) { partialWaits.push(p); },
  });
  await partialRes;
  await Promise.all(partialWaits);
  assert.equal(store.has('https://lunabitesanddelights.web.app/_astro/partial.js'), false);

  // Redirected 200 navigation responses break offline navigate mode if cached;
  // verify the worker skips caching them.
  const redirectWaits = [];
  let redirectRes = null;
  fetchHandler({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: 'https://lunabitesanddelights.web.app/staff/redirected',
    },
    respondWith(p) { redirectRes = p; },
    waitUntil(p) { redirectWaits.push(p); },
  });
  await redirectRes;
  await Promise.all(redirectWaits);
  assert.equal(store.has('https://lunabitesanddelights.web.app/staff/redirected'), false);
});

test('kds delayed badge keeps INK contrast on elapsed-time ticks and dashboard handles non-admin badge', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');
  assert.match(kdsSrc, /ageEl\.style\.color\s*=\s*delayed\s*\?\s*INK\s*:\s*elapsedColor\(ts,\s*now\)/);
  // The 30 s tick patches the card in place; rebuilding every column on each
  // delayed-flag flip stalls a cheap tablet for no visible gain.
  const tick = kdsSrc.slice(
    kdsSrc.indexOf('function refreshElapsedTimes'),
    kdsSrc.indexOf('const onVisibilityChange'),
  );
  assert.doesNotMatch(tick, /renderBoard\(\)/);
  assert.match(tick, /cardEl\.classList\.toggle\('is-delayed', delayed\)/);
  assert.match(tick, /ageEl\.classList\.toggle\('is-delayed', delayed\)/);
  assert.match(tick, /glyphEl\.textContent = glyph\(delayed \? 'warning_amber_rounded' : 'access_time_rounded'\)/);

  const dashSrc = readFileSync(join(root, 'app/src/staff/dashboard.ts'), 'utf8');
  assert.match(dashSrc, /staff\?\.isAdmin\s*\?\s*'ADMIN DASHBOARD'\s*:\s*'STAFF DASHBOARD'/);
  assert.match(dashSrc, /if\s*\(sheetLoading\s*\|\|\s*!getStaff\(\)\)\s*return;/);
  assert.match(dashSrc, /if\s*\(disposed\s*\|\|\s*seq\s*!==\s*fetchSeq\s*\|\|\s*!getStaff\(\)\)\s*return;/);

  const checkoutSrc = readFileSync(join(root, 'app/src/pages/kiosk/checkout.astro'), 'utf8');
  assert.match(checkoutSrc, /isWalkIn:\s*order\.type\s*===\s*'Walk-In'/);

  // KDS updateStatus clears busy state before haltOnAuthError, tears down background timers/listeners, and uses targeted renderBoard() in finally
  assert.match(kdsSrc, /function haltOnAuthError\(message: string\)\s*\{\s*authHalted = true;[\s\S]*stopBackgroundActivity\(\);/);
  assert.match(kdsSrc, /function stopBackgroundActivity\(\)[\s\S]*clearInterval\(clock\);[\s\S]*detachBackgroundListeners\?\.\(\);/);
  assert.match(kdsSrc, /if \(err && isAuthCode\(err\.code\)\)[\s\S]*updating\.delete\(orderId\);[\s\S]*haltOnAuthError\(/);
  assert.match(kdsSrc, /updating\.delete\(orderId\);\s*\n\s*if \(!disposed && !authHalted\) renderBoard\(\);/);
  assert.match(kdsSrc, /const onOnline = \(\) => \{[\s\S]*startLiveListener\(\)/);
  assert.match(kdsSrc, /await Promise\.all\(\[firebaseDb\(\), import\('firebase\/firestore'\)\]\);[\s\S]*if \(disposed \|\| authHalted\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*unsub\?\.\(\);/);
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

test('kds skips the board rebuild on metadata-only snapshots and stops after an auth halt', async () => {
  const { shouldSkipUnchangedLiveSnapshot } = await import('../../app/src/staff/kds-data.ts');
  assert.equal(shouldSkipUnchangedLiveSnapshot(true, '[{"id":"1"}]', '[{"id":"1"}]', 0), true);
  assert.equal(shouldSkipUnchangedLiveSnapshot(false, '[{"id":"1"}]', '[{"id":"1"}]', 0), false, 'reconnect must publish fresh state');
  assert.equal(shouldSkipUnchangedLiveSnapshot(true, '[{"id":"1"}]', '[{"id":"1"}]', 1), false, 'polled fallback orders must be cleared');
  assert.equal(shouldSkipUnchangedLiveSnapshot(true, '[{"id":"2"}]', '[{"id":"1"}]', 0), false);

  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');

  // includeMetadataChanges fires on cache/server flips; rebuilding every card for
  // those steals scroll position, so only the feed indicator is redrawn.
  assert.match(kdsSrc, /const wasLive = isLive;\s*isLive = true;/);
  assert.match(
    kdsSrc,
    /const unchanged = shouldSkipUnchangedLiveSnapshot\(\s*wasLive,\s*nextSignature,\s*liveSignature,\s*polled\.length,\s*fromCache,\s*polledFresh,?\s*\);/,
  );
  assert.match(kdsSrc, /if \(unchanged\) \{\s*if \(!fetchInFlight\) loading = false;\s*renderBar\(\);\s*renderBanner\(\);\s*return;\s*\}/);
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

test('kds hands the board to polling and keeps header buttons alive when nothing changed', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');

  // publish() merges the live snapshot over the polled one, so a fallback that
  // kept `live` would pin every ticket to its status at the moment the listener
  // died and hide the changes other staff make while polling is in charge.
  assert.match(kdsSrc, /const all = mergeKdsOrders\(live \?\? \[\], polled, polledFresh\);/);
  assert.match(
    kdsSrc,
    /function fallBackToPolling\(\) \{[\s\S]*?liveSignature = '';[\s\S]*?live = null;[\s\S]*?isLive = false;/,
    'the fallback must drop the retained live snapshot before polling takes over',
  );

  // The header and banner are rebuilt from the same markup on every snapshot;
  // re-creating their buttons steals focus and swallows the tap in flight.
  assert.match(kdsSrc, /let barHtml: string \| null = null;/);
  assert.match(kdsSrc, /let bannerHtml: string \| null = null;/);
  assert.match(kdsSrc, /if \(html === barHtml\) return;\s*barHtml = html;\s*bar\.innerHTML = html;/);
  assert.match(kdsSrc, /if \(html === bannerHtml\) return;\s*bannerHtml = html;\s*banner\.innerHTML = html;/);
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

test('mountLogin cancels backspace long-press on pointercancel and ignores late verifyStaff after dispose', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevClearTimeout = globalThis.clearTimeout;

  const timers = new Map();
  let nextTimerId = 1000;
  dom.window.setTimeout = (fn) => {
    const id = nextTimerId++;
    timers.set(id, fn);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    if (timers.has(id)) {
      timers.delete(id);
      return;
    }
    prevClearTimeout(id);
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  let resolveVerify = null;
  let signInCalls = 0;
  let snackCalls = 0;
  globalThis.__loginStubs = {
    callFn: () => new Promise((resolve) => { resolveVerify = resolve; }),
    signInWithToken: async () => { signInCalls += 1; },
    snack: () => { snackCalls += 1; },
  };

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes('app/src/staff/login.ts')) {
        if (specifier === '../kiosk/firebase.ts') return { url: 'stub://login-firebase', shortCircuit: true };
        if (specifier === './session.ts') return { url: 'stub://login-session', shortCircuit: true };
        if (specifier === '../kiosk/snackbar.ts') return { url: 'stub://login-snackbar', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub://login-firebase') {
        return {
          format: 'module',
          source: 'export const callFn = (...args) => globalThis.__loginStubs.callFn(...args);',
          shortCircuit: true,
        };
      }
      if (url === 'stub://login-session') {
        return {
          format: 'module',
          source: 'export const fnError = () => null; export const signInWithToken = (...args) => globalThis.__loginStubs.signInWithToken(...args);',
          shortCircuit: true,
        };
      }
      if (url === 'stub://login-snackbar') {
        return {
          format: 'module',
          source: 'export const snack = (...args) => globalThis.__loginStubs.snack(...args);',
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });

  try {
    const { mountLogin } = await import('../../app/src/staff/login.ts');
    const root = dom.window.document.getElementById('root');
    const dispose = mountLogin(root);

    // Enter 4 PIN digits.
    for (const d of ['1', '2', '3', '4']) {
      root.querySelector(`[data-digit="${d}"]`).click();
    }
    assert.equal(root.querySelector('.login__slots').getAttribute('aria-label'), '4 digits entered');

    // pointerdown on [data-back] starts the hold timer; pointercancel must clear it so the PIN survives.
    const backBtn = root.querySelector('[data-back]');
    backBtn.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(timers.size, 1, 'long-press should arm the hold timer');
    backBtn.dispatchEvent(new dom.window.Event('pointercancel', { bubbles: true }));
    assert.equal(timers.size, 0, 'pointercancel should clear the hold timer');
    for (const fn of [...timers.values()]) fn();
    assert.equal(root.querySelector('.login__slots').getAttribute('aria-label'), '4 digits entered');

    // Start an in-flight verifyStaff call, dispose the login view, then resolve the call late.
    root.querySelector('[data-submit]').click();
    assert.equal(typeof resolveVerify, 'function', 'submit should invoke verifyStaff');
    const htmlBeforeDispose = root.innerHTML;
    dispose();
    resolveVerify({ success: true, username: 'admin', role: 'admin', customToken: 'tok-123' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(signInCalls, 0, 'disposed login must not call signInWithToken on late verifyStaff response');
    assert.equal(snackCalls, 0, 'disposed login must not show a welcome snack on late response');
    assert.equal(root.innerHTML, htmlBeforeDispose, 'disposed login must not re-render in finally');
  } finally {
    hooks.deregister();
    delete globalThis.__loginStubs;
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.clearTimeout = prevClearTimeout;
  }
});

test('kds history toggle supersedes in-flight polling and map loadMaps times out cleanly', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');
  assert.match(kdsSrc, /if \(disposed \|\| authHalted\) \{\s*connecting = false;\s*return;\s*\}/);
  assert.match(kdsSrc, /if \(tab === 3 && !showCompleted\) \{\s*showCompleted = true;\s*publish\(\);\s*if \(!isLive\) void fetchActive\(false\);/);
  assert.match(kdsSrc, /else if \(act === 'history'\) \{\s*showCompleted = !showCompleted;\s*publish\(\);\s*if \(showCompleted && !isLive\) void fetchActive\(false\);/);

  const mapSrc = readFileSync(join(root, 'app/src/pages/kiosk/map.astro'), 'utf8');
  assert.match(mapSrc, /const MAPS_LOAD_TIMEOUT_MS = 10_000;/);
  assert.match(mapSrc, /reject\(new Error\('Google Maps load timed out'\)\)/);
  assert.match(mapSrc, /if \(degraded\) return;/);
});

test('showDialog tracks open modals and closeAllDialogs removes them on teardown', async () => {
  const { showDialog, closeAllDialogs } = await import('../../app/src/staff/ui.ts');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const prevDocument = globalThis.document;
  const origCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag, opts) => {
    const el = origCreate(tag, opts);
    if (tag.toLowerCase() === 'dialog') {
      el.open = false;
      el.showModal = () => { el.open = true; };
      el.close = () => {
        if (!el.open) return;
        el.open = false;
        el.dispatchEvent(new dom.window.Event('close'));
      };
    }
    return el;
  };
  globalThis.document = dom.window.document;
  try {
    const d1 = showDialog('<p>Order history</p>', 'osheet');
    const d2 = showDialog('<p>Cancel order</p>', 'sdialog');
    assert.equal(dom.window.document.querySelectorAll('dialog').length, 2);
    assert.equal(d1.open, true);
    assert.equal(d2.open, true);

    closeAllDialogs();
    assert.equal(d1.open, false);
    assert.equal(d2.open, false);
    assert.equal(dom.window.document.querySelectorAll('dialog').length, 0);
  } finally {
    globalThis.document = prevDocument;
    dom.window.close();
  }
});

test('kds post-mutation poll supersedes in-flight silent poll and gcash guards header back while verifying', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');
  assert.match(kdsSrc, /async function fetchActive\(silent = false, force = false\)/);
  assert.match(kdsSrc, /if \(silent && !force && fetchInFlight\) return;/);
  assert.match(kdsSrc, /if \(!isLive \|\| data\.changed === false\) await fetchActive\(true, true\);/);

  const gateSrc = readFileSync(join(root, 'app/src/staff/gate.ts'), 'utf8');
  assert.match(gateSrc, /closeAllDialogs\(\);/);

  const gcashSrc = readFileSync(join(root, 'app/src/pages/kiosk/gcash.astro'), 'utf8');
  assert.match(gcashSrc, /function cancel\(\) \{\s*if \(verifying\) return;/);
  assert.match(gcashSrc, /document\.querySelectorAll<HTMLButtonElement>\('\[data-cancel\]'\)\.forEach\(\(b\) => \{\s*b\.disabled = on;\s*\}\);/);
});

test('registerStaffServiceWorker registers immediately when document is already complete', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes('app/src/staff/gate.ts') && specifier === './session.ts') {
        return { url: 'stub://gate-session', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub://gate-session') {
        return {
          format: 'module',
          source: 'export const currentStaff = () => null; export const watchStaff = () => () => {};',
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
  try {
    const { registerStaffServiceWorker } = await import('../../app/src/staff/gate.ts');
    const calls = [];
    const fakeNav = {
      serviceWorker: {
        register: (url, opts) => {
          calls.push({ url, opts });
          return Promise.resolve();
        },
      },
    };
    let loadHandler = null;
    const fakeWin = {
      addEventListener(type, fn, opts) {
        assert.equal(type, 'load');
        assert.deepEqual(opts, { once: true });
        loadHandler = fn;
      },
    };

    // Already loaded: must register immediately without waiting for a load event that already fired.
    assert.equal(registerStaffServiceWorker(fakeWin, { readyState: 'complete' }, fakeNav), true);
    assert.deepEqual(calls, [{ url: '/staff/sw.js', opts: { scope: '/staff/' } }]);
    assert.equal(loadHandler, null);

    // Still loading: defers until window load fires once.
    calls.length = 0;
    assert.equal(registerStaffServiceWorker(fakeWin, { readyState: 'interactive' }, fakeNav), true);
    assert.equal(calls.length, 0);
    assert.equal(typeof loadHandler, 'function');
    loadHandler();
    assert.deepEqual(calls, [{ url: '/staff/sw.js', opts: { scope: '/staff/' } }]);

    // Missing serviceWorker support: returns false without throwing.
    assert.equal(registerStaffServiceWorker(fakeWin, { readyState: 'complete' }, {}), false);
  } finally {
    hooks.deregister();
  }
});

test('mountLogin clears submitted password from DOM even on successful verification', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://lunabitesanddelights.web.app/staff/',
  });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  globalThis.__loginStubs = {
    callFn: async () => ({ success: true, username: 'admin', role: 'admin', customToken: 'tok-ok' }),
    signInWithToken: async () => {},
    snack: () => {},
  };

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes('app/src/staff/login.ts')) {
        if (specifier === '../kiosk/firebase.ts') return { url: 'stub://login-firebase', shortCircuit: true };
        if (specifier === './session.ts') return { url: 'stub://login-session', shortCircuit: true };
        if (specifier === '../kiosk/snackbar.ts') return { url: 'stub://login-snackbar', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub://login-firebase') {
        return {
          format: 'module',
          source: 'export const callFn = (...args) => globalThis.__loginStubs.callFn(...args);',
          shortCircuit: true,
        };
      }
      if (url === 'stub://login-session') {
        return {
          format: 'module',
          source: 'export const fnError = () => null; export const signInWithToken = (...args) => globalThis.__loginStubs.signInWithToken(...args);',
          shortCircuit: true,
        };
      }
      if (url === 'stub://login-snackbar') {
        return {
          format: 'module',
          source: 'export const snack = (...args) => globalThis.__loginStubs.snack(...args);',
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });

  try {
    const { mountLogin } = await import('../../app/src/staff/login.ts');
    const root = dom.window.document.getElementById('root');
    const dispose = mountLogin(root);
    try {
      root.querySelector('[data-mode="password"]').click();
      const userInput = root.querySelector('input[name="user"]');
      const passInput = root.querySelector('input[name="pass"]');
      userInput.value = 'admin';
      passInput.value = 'TopSecret123';
      root.querySelector('form[data-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      const rerenderedPass = root.querySelector('input[name="pass"]');
      assert.ok(rerenderedPass instanceof dom.window.HTMLInputElement, 'password input must remain rendered');
      assert.equal(rerenderedPass.value, '', 'submitted password must not be re-rendered into DOM');
    } finally {
      dispose();
    }
  } finally {
    hooks.deregister();
    delete globalThis.__loginStubs;
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    dom.window.close();
  }
});

test('disposePendingLookups clears timers and aborts controllers, and kds locks actions on auth halt', async () => {
  const { disposePendingLookups } = await import('../../app/src/kiosk/geo.ts');
  const cleared = [];
  const searchAbort = new AbortController();
  const reverseAbort = new AbortController();
  const state = {
    searchTimer: 101,
    addressTimer: 202,
    searchAbort,
    reverseAbort,
  };
  disposePendingLookups(state, (id) => cleared.push(id));
  assert.deepEqual(cleared, [101, 202]);
  assert.equal(state.searchTimer, 0);
  assert.equal(state.addressTimer, 0);
  assert.equal(searchAbort.signal.aborted, true);
  assert.equal(reverseAbort.signal.aborted, true);
  assert.equal(state.searchAbort, null);
  assert.equal(state.reverseAbort, null);

  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kdsSrc = readFileSync(join(root, 'app/src/staff/kds.ts'), 'utf8');
  assert.match(kdsSrc, /loading \|\| authHalted \? ' disabled' : ''/);
  assert.match(kdsSrc, /const locked = busy \|\| authHalted;/);
  assert.match(kdsSrc, /authHalted \? '' : '<button type="button" class="kerr__btn" data-act="retry">RETRY<\/button>'/);

  const mapSrc = readFileSync(join(root, 'app/src/pages/kiosk/map.astro'), 'utf8');
  assert.match(mapSrc, /window\.addEventListener\('pagehide',[\s\S]*?disposePendingLookups/);
});

test('mountDashboard logs out instead of opening stale order sheet on expanded-fetch auth error', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://lunabitesanddelights.web.app/staff/dashboard',
  });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevAddEventListener = globalThis.addEventListener;
  const prevRemoveEventListener = globalThis.removeEventListener;
  const prevRequestAnimationFrame = globalThis.requestAnimationFrame;
  const prevCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const prevGetComputedStyle = globalThis.getComputedStyle;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

  dom.window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };

  let logoutCalls = 0;
  let activeOrdersCalls = 0;
  const tenOrders = Array.from({ length: 10 }, (_, i) => ({
    id: `ord_${i}`,
    orderNumber: `LU-00${i}`,
    customerName: `Guest ${i}`,
    type: 'Pickup',
    total: 99,
    timestamp: new Date().toISOString(),
    status: 'Pending',
  }));

  globalThis.__dashStubs = {
    callFn: async (name) => {
      if (name === 'getSalesAnalytics') {
        return { success: true, totalRevenue: 990, orderCount: 10, averageOrderValue: 99, totalItemsSold: 10 };
      }
      if (name === 'getActiveOrders') {
        activeOrdersCalls++;
        if (activeOrdersCalls === 1) return { success: true, orders: tenOrders };
        throw { code: 'functions/unauthenticated', message: 'Sign in required' };
      }
      return { success: true };
    },
    logout: async () => { logoutCalls++; },
  };

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../kiosk/firebase.ts') return { url: 'stub://dash-firebase', shortCircuit: true };
      if (specifier === './session.ts') return { url: 'stub://dash-session', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub://dash-firebase') {
        return {
          format: 'module',
          source: 'export const callFn = (...args) => globalThis.__dashStubs.callFn(...args);',
          shortCircuit: true,
        };
      }
      if (url === 'stub://dash-session') {
        return {
          format: 'module',
          source: `export const fnError = (e) => e && typeof e === 'object' && 'code' in e ? { code: String(e.code).replace(/^functions\\//, ''), message: String(e.message || e.code) } : null;
export const isAuthCode = (code) => code === 'unauthenticated' || code === 'permission-denied';
export const isAuthErrorText = () => false;
export const logout = (...args) => globalThis.__dashStubs.logout(...args);
export const staffErrorMessage = () => 'err';`,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });

  try {
    const { mountDashboard } = await import(`../../app/src/staff/dashboard.ts?test=${Date.now()}`);
    const root = dom.window.document.getElementById('root');
    const dispose = mountDashboard(root, () => ({ username: 'admin', role: 'admin', isAdmin: true }));
    try {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      root.querySelector('button[data-act="history"]').click();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(logoutCalls, 1, 'auth error during expanded history fetch must trigger logout');
      assert.equal(dom.window.document.querySelector('dialog.osheet'), null, 'stale order sheet must not open after auth failure');
    } finally {
      dispose();
    }
  } finally {
    hooks.deregister();
    delete globalThis.__dashStubs;
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.addEventListener = prevAddEventListener;
    globalThis.removeEventListener = prevRemoveEventListener;
    globalThis.requestAnimationFrame = prevRequestAnimationFrame;
    globalThis.cancelAnimationFrame = prevCancelAnimationFrame;
    globalThis.getComputedStyle = prevGetComputedStyle;
    dom.window.close();
  }
});

test('watchInactivity ignores duplicate warn while dialog is open without throwing', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://lunabitesanddelights.web.app/kiosk/menu',
  });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevSessionStorage = globalThis.sessionStorage;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.sessionStorage = dom.window.sessionStorage;

  let showModalCalls = 0;
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() {
    if (this.open) throw new dom.window.DOMException('Already open', 'InvalidStateError');
    this.open = true;
    showModalCalls++;
  };
  dom.window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };

  try {
    const { watchInactivity } = await import(`../../app/src/kiosk/inactivity.ts?test=${Date.now()}`);
    watchInactivity(20);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(showModalCalls, 1, 'idle dialog should open once');
    const dialog = dom.window.document.querySelector('dialog.idle');
    assert.ok(dialog && dialog.open, 'idle dialog should be open');
    // Triggering pagehide cleans up timers and closes cleanly.
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(dialog.open, false);
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.sessionStorage = prevSessionStorage;
    dom.window.close();
  }
});

test('mountKds cleans up print slip host and body class on teardown before afterprint', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://lunabitesanddelights.web.app/staff/kds',
  });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevMatchMedia = globalThis.matchMedia;
  const prevAddEventListener = globalThis.addEventListener;
  const prevRemoveEventListener = globalThis.removeEventListener;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  const fakeMatchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.matchMedia = fakeMatchMedia;
  dom.window.matchMedia = fakeMatchMedia;
  dom.window.print = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };

  globalThis.__kdsPrintStubs = {
    callFn: async () => ({
      success: true,
      orders: [{
        id: 'ord_p1',
        orderNumber: 'LU-P1',
        customerName: 'Ana',
        type: 'Pickup',
        status: 'Pending',
        total: 99,
        items: [{ name: 'Shawarma Wrap', variant: 'Solo', quantity: 1 }],
        timestamp: new Date().toISOString(),
      }],
    }),
  };

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../kiosk/firebase.ts') return { url: 'stub://kds-print-firebase', shortCircuit: true };
      if (specifier === './chime.ts') return { url: 'stub://kds-print-chime', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub://kds-print-firebase') {
        return {
          format: 'module',
          source: `export const callFn = (...args) => globalThis.__kdsPrintStubs.callFn(...args);
export const firebaseDb = () => Promise.reject(new Error('offline'));
export const firebaseAuth = () => Promise.reject(new Error('offline'));`,
          shortCircuit: true,
        };
      }
      if (url === 'stub://kds-print-chime') {
        return {
          format: 'module',
          source: 'export let soundEnabled = false; export const setSound = () => {}; export const playOrderChime = () => {};',
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });

  try {
    const { mountKds } = await import(`../../app/src/staff/kds.ts?test=${Date.now()}`);
    const root = dom.window.document.getElementById('root');
    const dispose = mountKds(root, () => ({ username: 'admin', role: 'admin', isAdmin: true }));
    await new Promise((r) => setTimeout(r, 30));
    const ticketBtn = root.querySelector('button[data-ticket="ord_p1"]');
    assert.ok(ticketBtn, 'ticket button should render for loaded order');
    ticketBtn.click();
    const printBtn = dom.window.document.querySelector('dialog button[data-print]');
    assert.ok(printBtn, 'print button should render inside ticket dialog');
    printBtn.click();
    assert.equal(dom.window.document.body.classList.contains('is-printing-slip'), true);
    assert.ok(dom.window.document.querySelector('.kslip-print'));
    // Tear down before afterprint fires: print artifacts must be cleaned up immediately.
    dispose();
    assert.equal(dom.window.document.body.classList.contains('is-printing-slip'), false);
    assert.equal(dom.window.document.querySelector('.kslip-print'), null);
  } finally {
    hooks.deregister();
    delete globalThis.__kdsPrintStubs;
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.matchMedia = prevMatchMedia;
    globalThis.addEventListener = prevAddEventListener;
    globalThis.removeEventListener = prevRemoveEventListener;
    dom.window.close();
  }
});

/** Mounts the KDS in jsdom with stubbed Firebase/chime modules; `stub.callFn` answers the callables. */
async function mountKdsForTest(stub) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://lunabitesanddelights.web.app/staff/kds',
  });
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  const fakeMatchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = fakeMatchMedia;
  dom.window.matchMedia = fakeMatchMedia;

  globalThis.__kdsFeedStubs = stub;
  const { registerHooks } = await import('node:module');
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../kiosk/firebase.ts') return { url: 'stub://kds-feed-firebase', shortCircuit: true };
      if (specifier === './chime.ts') return { url: 'stub://kds-feed-chime', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub://kds-feed-firebase') {
        return {
          format: 'module',
          source: `export const callFn = (...args) => globalThis.__kdsFeedStubs.callFn(...args);
export const firebaseDb = () => Promise.reject(new Error('offline'));
export const firebaseAuth = () => Promise.reject(new Error('offline'));`,
          shortCircuit: true,
        };
      }
      if (url === 'stub://kds-feed-chime') {
        return {
          format: 'module',
          source: 'export let soundEnabled = false; export const setSound = () => {}; export const playOrderChime = () => {};',
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
  const { mountKds } = await import(`../../app/src/staff/kds.ts?feed=${Date.now()}-${Math.random()}`);
  const root = dom.window.document.getElementById('root');
  const dispose = mountKds(root, () => ({ username: 'admin', role: 'admin', isAdmin: true }));
  const cleanup = () => {
    dispose();
    hooks.deregister();
    delete globalThis.__kdsFeedStubs;
    globalThis.window = prev.window;
    globalThis.document = prev.document;
    globalThis.matchMedia = prev.matchMedia;
    globalThis.addEventListener = prev.addEventListener;
    globalThis.removeEventListener = prev.removeEventListener;
    dom.window.close();
  };
  return { dom, root, cleanup };
}

const feedOrder = {
  id: 'ord_feed1',
  orderNumber: 'LU-FEED1',
  customerName: 'Ana',
  type: 'Pickup',
  status: 'Pending',
  total: 99,
  items: [{ name: 'Shawarma Wrap', variant: 'Solo', quantity: 1 }],
  timestamp: new Date().toISOString(),
};

test('a live feed update keeps the KDS search box node, value and focus', async () => {
  const stub = {
    callFn: async () => ({ success: true, orders: [feedOrder], scanned: 1, truncated: false }),
  };
  const { dom, root, cleanup } = await mountKdsForTest(stub);
  try {
    await new Promise((r) => setTimeout(r, 60));
    const input = root.querySelector('[data-search]');
    assert.ok(input, 'search box renders');
    input.value = 'shawarma';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.focus();
    assert.equal(dom.window.document.activeElement, input);

    // A second feed refresh used to rebuild the whole control bar through
    // renderControls(), replacing the input and dropping focus mid-typing.
    root.querySelector('[data-act="sync"]').click();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(root.querySelector('[data-search]'), input, 'the search input must not be re-created');
    assert.equal(input.value, 'shawarma', 'typed text survives the refresh');
    assert.equal(dom.window.document.activeElement, input, 'focus stays in the search box');
  } finally {
    cleanup();
  }
});

test('the KDS surfaces a truncated order scan instead of showing a partial board as complete', async () => {
  let truncated = true;
  const stub = {
    callFn: async () => ({
      success: true,
      orders: [feedOrder],
      scanned: truncated ? 2000 : 1,
      truncated,
    }),
  };
  const { root, cleanup } = await mountKdsForTest(stub);
  try {
    await new Promise((r) => setTimeout(r, 60));
    const banner = root.querySelector('[data-banner] .kerr--warn');
    assert.ok(banner, 'a warning banner is shown');
    assert.match(banner.textContent, /Partial board/);
    assert.match(banner.textContent, /2000 orders/);
    assert.ok(banner.querySelector('[data-act="retry"]'), 'the banner offers a SYNC recovery');

    truncated = false;
    banner.querySelector('[data-act="retry"]').click();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(root.querySelector('[data-banner] .kerr--warn'), null, 'a complete scan clears the warning');
  } finally {
    cleanup();
  }
});

test('a duplicate status tap reports the order as already in that column', async () => {
  const stub = {
    callFn: async (name) => {
      if (name === 'updateOrderStatus') return { success: true, changed: false };
      return { success: true, orders: [feedOrder], scanned: 1, truncated: false };
    },
  };
  const { dom, root, cleanup } = await mountKdsForTest(stub);
  try {
    await new Promise((r) => setTimeout(r, 60));
    const start = root.querySelector('[data-status="Preparing"]');
    assert.ok(start, 'the pending card offers START PREPARING');
    start.click();
    await new Promise((r) => setTimeout(r, 60));
    const snack = dom.window.document.querySelector('.snack');
    assert.ok(snack, 'a snackbar reports the outcome');
    assert.match(snack.textContent, /Order already Preparing/);
  } finally {
    cleanup();
  }
});
