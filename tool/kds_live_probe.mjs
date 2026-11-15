// Live kitchen-screen proof against the Firebase emulators (demo project).
// Serves the tool/kds_live_preview.dart web build, opens it in headless
// Chrome (muted, no window), writes orders with the Admin SDK and times how
// long each takes to appear on screen, then screenshots supported widths.
//
//   flutter build web -t tool/kds_live_preview.dart --output <dir>
//   cd functions && npx firebase-tools emulators:exec --project demo-lunaexpress \
//     --only auth,firestore,functions "node ../tool/kds_live_probe.mjs --build=<dir>"
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'functions', 'package.json'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.split('='); return [k.replace(/^--/, ''), v.join('=') || true]; }));
const buildDir = resolve(args.build);
const outDir = resolve(args.out ?? join(root, 'docs', 'evidence'));
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Run inside emulators:exec with a demo- project');

initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.otf': 'font/otf', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  let rel = new URL(req.url, 'http://x').pathname.slice(1) || 'index.html';
  let file = join(buildDir, normalize(rel));
  if (!file.startsWith(buildDir) || !existsSync(file) || !statSync(file).isFile()) file = join(buildDir, 'index.html');
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

const order = (n, name, over = {}) => ({
  orderId: `LU-251115-00${n}`, customerName: name, customerPhone: '09171234567', customerAddress: 'Purok 5, Poblacion',
  items: [{ name: 'Shawarma Wrap', variant: 'Spicy', price: 79, quantity: 2 }, { name: 'Milo Craze', variant: 'Oreo', price: 65, quantity: 1 }],
  totalAmount: 223, type: 'Delivery', entryType: 'Kiosk', paymentMethod: 'Cash', paymentStatus: 'NOT PAID',
  status: 'Pending', dateLabel: '2026-11-15', timestamp: Timestamp.fromMillis(Date.now() - n * 60000), ...over,
});

let chrome; const profileDir = join(tmpdir(), `luna-kds-probe-${process.pid}`);
try {
  mkdirSync(outDir, { recursive: true });
  // Staff account the preview build signs in with (see tool/kds_live_preview.dart).
  const staff = await getAuth().createUser({ uid: 'staff_tester', email: 'staff@kds.test', password: 'kds-probe-only' });
  await getAuth().setCustomUserClaims(staff.uid, { role: 'staff' });
  await db.doc('orders/seed1').set(order(1, 'Ana Reyes'));
  await db.doc('orders/seed2').set(order(2, 'Ben Cruz', { status: 'Preparing', type: 'Pickup' }));
  await db.doc('orders/seed3').set(order(3, 'Carla Lim', { status: 'Ready', type: 'Walk-In', entryType: 'Staff', paymentStatus: 'PAID' }));
  for (let i = 0; i < 100 && (await db.collection('kds_orders').count().get()).data().count < 3; i++) await sleep(100);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const debugPort = 9600 + (port % 100);
  chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--no-sandbox', '--enable-unsafe-swiftshader', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
  let pages;
  for (let i = 0; i < 80 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); } catch { await sleep(150); } }
  const s = await cdp(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await s.send('Page.enable'); await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

  const text = async () => (await s.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('flt-semantics, [aria-label]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')).join(' | ')`,
    returnByValue: true,
  })).result.value ?? '';
  const logs = [];
  s.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  });
  // Flutter web keeps the semantics tree off until this placeholder is activated.
  const enableSemantics = () => s.send('Runtime.evaluate', { expression: `document.querySelector('flt-semantics-placeholder')?.click(); true` });
  const waitFor = async (needle, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const t = await text();
      if (t.includes(needle)) return Date.now() - t0;
      if (t.includes('Enable accessibility')) await enableSemantics();
      await sleep(25);
    }
    const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(tmpdir(), 'kds-probe-fail.png'), Buffer.from(data, 'base64'));
    throw new Error(`"${needle}" never appeared. Screen text: ${(await text()).slice(0, 600)}\nConsole:\n${logs.slice(-30).join('\n')}`);
  };

  await waitFor('Ana Reyes', 60000);
  await waitFor('Orders update live');
  const result = { capturedAt: new Date().toISOString(), header: 'Purok 5 Kiosk · Live', newOrderToScreenMs: [], statusChangeToScreenMs: [] };

  // New orders: Firestore write → trigger mirrors → listener pushes → card paints.
  for (let i = 0; i < 5; i++) {
    const name = `Live Test ${i + 1}`;
    const t0 = Date.now();
    await db.doc(`orders/live${i}`).set(order(10 + i, name, { timestamp: Timestamp.now() }));
    await waitFor(name);
    result.newOrderToScreenMs.push(Date.now() - t0);
    await sleep(300);
  }
  // Status change on the top (on-screen) card: Pending → Completed leaves the
  // active board. Off-screen cards are not in the semantics tree, so measure a
  // visible one and confirm it is there first.
  for (const [i, status] of [[4, 'Completed'], [3, 'Cancelled'], [2, 'Completed']]) {
    const name = `Live Test ${i + 1}`;
    await waitFor(name);
    const t0 = Date.now();
    await db.doc(`orders/live${i}`).update({ status });
    while ((await text()).includes(name) && Date.now() - t0 < 30000) await sleep(10);
    result.statusChangeToScreenMs.push(Date.now() - t0);
    await sleep(300);
  }
  const sorted = (xs) => [...xs].sort((a, b) => a - b);
  result.newOrderMedianMs = sorted(result.newOrderToScreenMs)[2];
  result.previousWorstCaseMs = '10,000 ms poll interval + callable round trip';

  for (const [w, h, dpr] of [[320, 640, 2], [390, 844, 2], [768, 1024, 2], [1440, 900, 1]]) {
    await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 700 });
    await sleep(1500);
    const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `kds-live-${w}.png`), Buffer.from(data, 'base64'));
  }
  writeFileSync(join(outDir, 'kds-live-latency.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  s.ws.close();
} finally {
  if (chrome) chrome.kill('SIGKILL');
  server.close();
  for (let i = 0; i < 5; i++) { try { rmSync(profileDir, { recursive: true, force: true }); break; } catch { await sleep(400); } }
}
