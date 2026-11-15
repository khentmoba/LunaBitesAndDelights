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
const siteDir = resolve(args.site ?? join(root, 'site'));
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
  { name: 'kiosk-receipt', flutter: '/kiosk/?push=receipt#/menu', ts: '/kiosk/receipt?demo=1' },
  { name: 'kiosk-gcash', flutter: '/kiosk/?push=gcash#/menu', ts: '/kiosk/gcash?demo=1' },
  { name: 'staff-login', flutter: '/kiosk/#/kds', ts: '/staff/' },
  { name: 'staff-kds', flutter: '/kiosk/?staff=1#/kds', ts: '/staff/kds?staff=1' },
  { name: 'staff-dashboard', flutter: '/kiosk/?staff=1#/dashboard', ts: '/staff/dashboard?staff=1', settle: 7000 },
  { name: 'staff-analytics', flutter: '/kiosk/?staff=1#/analytics', ts: '/staff/analytics?staff=1', settle: 7000 },
  { name: 'staff-lifetime', flutter: '/kiosk/?staff=1#/lifetime-analytics', ts: '/staff/lifetime?staff=1', settle: 7000 },
];

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

// Fixed seed so both targets render identical data.
const today = new Date();
const dateLabel = today.toISOString().slice(0, 10);
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

let chrome; const profileDir = join(tmpdir(), `luna-parity-${process.pid}`);
try {
  mkdirSync(outDir, { recursive: true });
  initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  const staff = await getAuth().createUser({ uid: 'staff_tester', email: 'staff@parity.test', password: 'parity-only' });
  await getAuth().setCustomUserClaims(staff.uid, { role: 'staff' });
  for (const [i, o] of SEED.entries()) await db.doc(`orders/seed${i + 1}`).set(o);
  for (let i = 0; i < 100 && (await db.collection('kds_orders').count().get()).data().count < 3; i++) await sleep(100);

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
      await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 700 });
      await s.send('Page.navigate', { url: `http://127.0.0.1:${port}${path}` });
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
