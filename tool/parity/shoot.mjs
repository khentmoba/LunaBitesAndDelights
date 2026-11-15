// Screen-parity capture: screenshots every storefront and kiosk screen at the
// supported viewports, against the Firebase emulators (demo project), in
// headless muted Chrome. The Flutter build is the baseline; the TypeScript
// rewrite is captured with the same seed data, screens and viewports so the
// two sets can be compared side by side and pixel-diffed.
//
//   flutter build web --release --wasm -t tool/parity/flutter_preview.dart \
//     --base-href /kiosk/ --output build/parity-flutter
//   cd functions && npx firebase-tools emulators:exec --project demo-lunaexpress \
//     --only auth,firestore,functions \
//     "node ../tool/parity/shoot.mjs --target=flutter --kiosk=../build/parity-flutter"
//
// Output: docs/evidence/parity/<target>/<screen>-<width>.png
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'functions', 'package.json'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.split('='); return [k.replace(/^--/, ''), v.join('=') || true]; }));
const target = args.target ?? 'flutter';
const kioskDir = args.kiosk ? resolve(args.kiosk) : null;
const siteDir = resolve(args.site ?? join(root, 'build', 'app'));
const outDir = resolve(args.out ?? join(root, 'docs', 'evidence', 'parity', target));
const only = args.only ? new Set(String(args.only).split(',')) : null;
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Run inside emulators:exec with a demo- project');

export const VIEWPORTS = [[320, 640, 2], [390, 844, 2], [768, 1024, 2], [1440, 900, 1]];

// One entry per screen. `flutter` is the path+query+hash on the Flutter
// harness; `ts` is the same screen in the TypeScript app. `full` captures the
// whole scrolling page (storefront only: Flutter paints one canvas).
export const SCREENS = [
  { name: 'storefront-home', flutter: '/', ts: '/', full: true },
  { name: 'storefront-menu', flutter: '/menu/', ts: '/menu/', full: true },
  { name: 'storefront-404', flutter: '/404.html', ts: '/404.html', full: true },
  { name: 'kiosk-splash', flutter: '/kiosk/#/', ts: '/kiosk/', settle: 2500 },
  { name: 'kiosk-menu', flutter: '/kiosk/#/menu', ts: '/kiosk/menu' },
  { name: 'kiosk-cart-empty', flutter: '/kiosk/#/cart', ts: '/kiosk/cart' },
  { name: 'kiosk-cart', flutter: '/kiosk/?cart=1#/cart', ts: '/kiosk/cart?cart=1' },
  { name: 'kiosk-checkout', flutter: '/kiosk/?cart=1#/checkout_process', ts: '/kiosk/checkout?cart=1' },
  { name: 'kiosk-receipt', flutter: '/kiosk/?push=receipt#/menu', ts: '/kiosk/receipt', session: () => ({ 'luna.receipt': TS_RECEIPT }) },
  { name: 'kiosk-gcash', flutter: '/kiosk/?push=gcash#/menu', ts: '/kiosk/gcash', session: () => ({ 'luna.pending': TS_PENDING }), script: 'window.open = () => null;', callables: () => ({ createCheckoutSession: { checkoutUrl: 'https://checkout.paymongo.com/cs_parity', checkoutSessionId: 'cs_parity' } }) },
  // TypeScript only: Flutter's preview harness never opened these, so they have no baseline.
  { name: 'kiosk-checkout-delivery', flutter: null, ts: '/kiosk/checkout?cart=1', session: () => ({ 'luna.checkout': TS_DELIVERY_DRAFT }) },
  { name: 'staff-console', flutter: null, ts: '/kiosk/menu?staff=1', settle: 4000, session: () => ({}), script: "addEventListener('load', () => setTimeout(() => document.querySelector('[data-console]')?.click(), 1500));" },
  { name: 'kiosk-map', flutter: null, ts: '/kiosk/map', session: () => ({ 'luna.checkout': TS_DELIVERY_DRAFT }), script: () => MAP_STUBS },
  { name: 'staff-login', flutter: '/kiosk/#/kds', ts: '/staff/' },
  { name: 'staff-kds', flutter: '/kiosk/?staff=1#/kds', ts: '/staff/kds?staff=1' },
  { name: 'staff-dashboard', flutter: '/kiosk/?staff=1#/dashboard', ts: '/staff/dashboard?staff=1', settle: 7000 },
  { name: 'staff-analytics', flutter: '/kiosk/?staff=1#/analytics', ts: '/staff/analytics?staff=1', settle: 7000 },
  { name: 'staff-lifetime', flutter: '/kiosk/?staff=1#/lifetime-analytics', ts: '/staff/lifetime?staff=1', settle: 7000 },
  { name: 'staff-menu', flutter: '/kiosk/?staff=1#/menu', ts: '/kiosk/menu?staff=1', settle: 4000 },
  { name: 'staff-checkout', flutter: '/kiosk/?staff=1&cart=1&push=checkout#/menu', ts: '/kiosk/checkout?cart=1&staff=1', settle: 5000 },
];

const TS_CART = [
  { id: 'sm3', name: 'S3 – Shawarma Rice', emoji: '🌯🍚', imageUrl: 'images/sulit_shawarma.webp', variant: '', price: 99, quantity: 2 },
  { id: 'mc1', name: 'Milo Craze', emoji: '🥤', imageUrl: '', variant: 'Oreo', price: 65, quantity: 1 },
];

// What flutter_preview.dart passes ReceiptPage and GCashCheckoutPage for
// ?push=receipt and ?push=gcash. The TypeScript pages read the same values from
// sessionStorage, where checkout leaves them.
const TS_ITEMS = TS_CART.map(({ name, variant, price, quantity }) => ({ name, variant, price, quantity }));
const TS_RECEIPT = {
  orderNumber: 'LU-261115-001', customerName: 'Ana Reyes', customerAddress: 'Purok 5, Poblacion Magallanes',
  customerPhone: '09171234567', items: TS_ITEMS, total: 263, timeStr: 'Nov 15, 2026 · 12:30 PM',
  isWalkIn: false, orderType: 'Delivery', telegramSent: true,
};
const TS_PENDING = {
  orderDocId: 'parity-order', orderId: 'LU-261115-001', amount: 263, items: TS_ITEMS,
  customerName: 'Ana Reyes', customerPhone: '09171234567', receipt: TS_RECEIPT,
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.bin': 'application/octet-stream' };
const isFile = (f) => existsSync(f) && statSync(f).isFile();
function resolveFile(pathname) {
  if (kioskDir && pathname.startsWith('/kiosk/')) {
    const f = join(kioskDir, normalize(pathname.slice('/kiosk/'.length) || 'index.html'));
    if (f.startsWith(kioskDir) && isFile(f)) return f;
    return join(kioskDir, 'index.html');
  }
  let f = join(siteDir, normalize(pathname.slice(1)));
  if (!f.startsWith(siteDir)) return null;
  if (!isFile(f) && isFile(join(f, 'index.html'))) f = join(f, 'index.html');
  return isFile(f) ? f : null;
}
const server = createServer((req, res) => {
  const file = resolveFile(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file) { res.writeHead(404, { 'Content-Type': MIME['.html'] }); res.end(readFileSync(join(siteDir, '404.html'))); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { ws, send };
}

// A pinned delivery draft, and the map page's browser services answered
// in-page: no position, and a fixed Nominatim reply.
const TS_DELIVERY_DRAFT = {
  name: 'Ana Reyes', phone: '09171234567', address: 'Purok 5, Poblacion, Magallanes, Agusan del Norte, Caraga, 8604, Philippines',
  orderType: 'Delivery', paymentMethod: 'Cash', lat: 9.020509, lng: 125.517591, pinned: true, distance: 0.4, pendingDocId: null, pendingNumber: null,
};
const MAP_STUBS = `
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (ok, fail) => fail({ code: 1 }) } });
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => String(url).startsWith('https://nominatim.openstreetmap.org/')
    ? Promise.resolve(new Response(JSON.stringify({ display_name: ${JSON.stringify(TS_DELIVERY_DRAFT.address)}, address: { road: 'Purok 5', suburb: 'Poblacion', town: 'Magallanes' } }), { headers: { 'Content-Type': 'application/json' } }))
    : realFetch(url, init);
`;

// Fixed seed so both targets render identical data.
const today = new Date();
// Same PHT (UTC+8) day as phtDateLabel in functions/src/util.ts, or analytics finds no orders before 08:00 PHT.
const dateLabel = new Date(today.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const order = (n, name, over = {}) => ({
  orderId: `LU-261115-00${n}`, customerName: name, customerPhone: '09171234567', customerAddress: 'Purok 5, Poblacion Magallanes',
  items: [{ name: 'S3 – Shawarma Rice', variant: '', price: 99, quantity: 2 }, { name: 'Milo Craze', variant: 'Oreo', price: 65, quantity: 1 }],
  totalAmount: 263, type: 'Delivery', entryType: 'Kiosk', paymentMethod: 'Cash', paymentStatus: 'NOT PAID',
  status: 'Pending', dateLabel, timestamp: Timestamp.fromMillis(today.getTime() - n * 60000), ...over,
});
const SEED = [
  order(1, 'Ana Reyes'),
  order(2, 'Ben Cruz', { status: 'Preparing', type: 'Pickup' }),
  order(3, 'Carla Lim', { status: 'Ready', type: 'Walk-In', entryType: 'Staff', paymentStatus: 'PAID' }),
  order(4, 'Dan Santos', { status: 'Completed', paymentMethod: 'GCash', paymentStatus: 'PAID' }),
  order(5, 'Eva Ramos', { status: 'Completed', type: 'Pickup', paymentStatus: 'PAID', items: [{ name: 'Fries & Nachos Overload', variant: 'Barkada', price: 150, quantity: 1 }], totalAmount: 150 }),
];

// The harness staff user's Firebase Auth session, from the auth emulator.
const API_KEY = 'AIzaSyBAtF167ua5zEH-xhP2U9dObFWlQz3lF-Y';
async function staffSession() {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff@parity.test', password: 'parity-only', returnSecureToken: true }),
  });
  const r = await res.json();
  if (!r.idToken) throw new Error(`staff sign-in failed: ${JSON.stringify(r)}`);
  return {
    key: `firebase:authUser:${API_KEY}:[DEFAULT]`,
    value: {
      uid: r.localId, email: r.email, emailVerified: false, isAnonymous: false, providerData: [],
      stsTokenManager: { refreshToken: r.refreshToken, accessToken: r.idToken, expirationTime: Date.now() + Number(r.expiresIn) * 1000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
    },
  };
}
// Runs in the page: the row firebase/auth's IndexedDB persistence reads on start.
const persistStaffUser = ({ key, value }) => new Promise((resolve, reject) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value });
    tx.oncomplete = () => { open.result.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
});

let chrome; const profileDir = join(tmpdir(), `luna-parity-${process.pid}`);
try {
  mkdirSync(outDir, { recursive: true });
  initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  const staff = await getAuth().createUser({ uid: 'staff_tester', email: 'staff@parity.test', password: 'parity-only' });
  await getAuth().setCustomUserClaims(staff.uid, { role: 'staff' });
  for (const [i, o] of SEED.entries()) await db.doc(`orders/seed${i + 1}`).set(o);
  for (let i = 0; i < 100 && (await db.collection('kds_orders').count().get()).data().count < SEED.length; i++) await sleep(100);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const debugPort = 9500 + (port % 100);
  chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-color-profile=srgb', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 80 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { await sleep(150); } }
  const browser = await cdp(version.webSocketDebuggerUrl);
  const errors = [];
  const timedOut = [];
  const manifest = { target, capturedAt: new Date().toISOString(), viewports: VIEWPORTS, screens: [] };

  // Each capture gets a fresh browser context, so no auth state or IndexedDB
  // lock carries over from the previous page.
  async function capture(screen, path, [w, h, dpr]) {
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const s = await cdp(list.find((p) => p.id === targetId).webSocketDebuggerUrl);
    try {
      await s.send('Page.enable'); await s.send('Runtime.enable');
      s.ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.method === 'Runtime.exceptionThrown') errors.push(`${screen.name}-${w}: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`${screen.name}-${w}: console.error ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      });
      const evaluate = async (expression) => (await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
      // The TypeScript kiosk keeps its cart in sessionStorage; seed the same two
      // items flutter_preview.dart puts in the Flutter cart for ?cart=1.
      if (target === 'ts' && /[?&]cart=1/.test(path)) {
        await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('luna.cart', ${JSON.stringify(JSON.stringify(TS_CART))})` });
      }
      if (target === 'ts' && screen.session) {
        const writes = Object.entries(screen.session()).map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))});`);
        await s.send('Page.addScriptToEvaluateOnNewDocument', { source: writes.join('') + (typeof screen.script === 'function' ? screen.script() : screen.script ?? '') });
      }
      // Callables answer from the screen's table, as flutter_preview.dart's fake
      // checkout call does, so no request reaches a real function.
      if (target === 'ts' && screen.callables) {
        const table = screen.callables();
        const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }];
        s.ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data);
          if (m.method !== 'Fetch.requestPaused') return;
          const name = Object.keys(table).find((n) => m.params.request.url.endsWith(`/${n}`));
          if (!name) { s.send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}); return; }
          const preflight = m.params.request.method === 'OPTIONS';
          s.send('Fetch.fulfillRequest', {
            requestId: m.params.requestId, responseCode: preflight ? 204 : 200,
            responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }],
            body: preflight ? '' : Buffer.from(JSON.stringify({ result: table[name] })).toString('base64'),
          }).catch(() => {});
        });
        await s.send('Fetch.enable', { patterns: Object.keys(table).map((n) => ({ urlPattern: `*/${n}` })) });
      }
      await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 700 });
      // Staff screens: flutter_preview.dart signs the harness staff user in for
      // ?staff=1. The TypeScript app gets the same user written where the
      // Firebase Auth SDK keeps it, from a page that loads no Firebase, and is
      // opened from the kiosk as the Flutter route was pushed (back arrow).
      let referrer;
      if (target === 'ts' && /[?&]staff=1/.test(path)) {
        await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/404.html` });
        for (let i = 0; i < 100 && (await evaluate('document.readyState').catch(() => '')) !== 'complete'; i++) await sleep(50);
        await evaluate(`(${persistStaffUser})(${JSON.stringify(await staffSession())})`);
        referrer = `http://127.0.0.1:${port}/kiosk/`;
      }
      await s.send('Page.navigate', { url: `http://127.0.0.1:${port}${path}`, ...(referrer ? { referrer } : {}) });
      // Flutter: wait for the first frame (the HTML splash fades out); plain pages: load + fonts.
      const t0 = Date.now();
      let ready = false;
      while (!ready && Date.now() - t0 < 45000) {
        ready = await evaluate(`document.readyState === 'complete' && (() => { const l = document.getElementById('loading-screen'); return !l || l.classList.contains('fade-out'); })()`).catch(() => false);
        if (!ready) await sleep(100);
      }
      if (!ready) timedOut.push(`${screen.name}-${w}`);
      await evaluate(`document.fonts ? document.fonts.ready.then(() => true) : true`).catch(() => {});
      await sleep(screen.settle ?? (path.startsWith('/kiosk/') || path.startsWith('/staff/') ? 2500 : 800));
      await evaluate(`document.querySelectorAll('.firebase-emulator-warning').forEach((e) => e.remove()); true`).catch(() => {});
      const shot = { format: 'png' };
      if (screen.full) {
        const { contentSize } = await s.send('Page.getLayoutMetrics');
        shot.captureBeyondViewport = true;
        shot.clip = { x: 0, y: 0, width: w, height: Math.min(Math.ceil(contentSize.height), 16000), scale: 1 };
      }
      const { data } = await s.send('Page.captureScreenshot', shot);
      const file = `${screen.name}-${w}.png`;
      writeFileSync(join(outDir, file), Buffer.from(data, 'base64'));
      manifest.screens.push({ name: screen.name, width: w, file, path, ready });
      console.log(`captured ${file}${ready ? '' : ' (TIMED OUT waiting for first frame)'}`);
    } finally {
      s.ws.close();
      await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    }
  }

  for (const screen of SCREENS) {
    if (only && !only.has(screen.name)) continue;
    const path = screen[target];
    if (!path) continue;
    if (path.startsWith('/kiosk/') && target === 'flutter' && !kioskDir) continue;
    for (const vp of VIEWPORTS) await capture(screen, path, vp);
  }
  manifest.timedOut = timedOut;
  manifest.errors = errors;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (errors.length) console.log(`page errors:\n${errors.join('\n')}`);
  if (timedOut.length) { console.log(`timed out: ${timedOut.join(', ')}`); process.exitCode = 1; }
  browser.ws.close();
} finally {
  if (chrome) chrome.kill('SIGKILL');
  server.close();
  for (let i = 0; i < 5; i++) { try { rmSync(profileDir, { recursive: true, force: true }); break; } catch { await sleep(400); } }
}
