// End-to-end staff shift: in headless muted Chrome a staff member types a
// wrong PIN, then the right one, on /staff/. verifyStaff on the Functions
// emulator checks the scrypt hash and mints the custom token, the kitchen
// display opens, and START PREPARING then MARK AS READY move a real order
// through updateOrderStatus. The dashboard then reads today's numbers.
//
//   PUBLIC_FIREBASE_EMULATORS=1 npm run build --prefix app
//   npm run build --prefix functions
//   cd functions && npx firebase-tools emulators:exec --project demo-lunaexpress \
//     --only auth,firestore,functions "node ../tool/parity/staff_e2e.mjs --out=../docs/evidence"
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, statSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'functions', 'package.json'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { hashPassword } = require(join(root, 'functions', 'lib', 'util', 'security.js'));

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.split('='); return [k.replace(/^--/, ''), v.join('=') || true]; }));
const siteDir = resolve(args.site ?? join(root, 'build', 'app'));
const outDir = resolve(args.out ?? join(root, 'docs', 'evidence'));
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Run inside emulators:exec with a demo- project');

initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();

const PIN = '246810';
const ORDER_ID = 'e2e-staff-1';
await db.doc('staff_accounts/anna').set({ username: 'anna', role: 'staff', pinHash: hashPassword(PIN), passwordHash: hashPassword('kitchen-e2e'), createdAt: new Date() });
const now = new Date();
await db.doc(`orders/${ORDER_ID}`).set({
  orderId: 'LU-E2E-001', customerName: 'Ana Reyes', customerPhone: '09171234567', customerAddress: 'Purok 5, Poblacion Magallanes',
  items: [{ name: 'S3 – Shawarma Rice', variant: '', price: 99, quantity: 2 }, { name: 'Milo Craze', variant: 'Oreo', price: 65, quantity: 1 }],
  totalAmount: 263, type: 'Pickup', entryType: 'Kiosk', paymentMethod: 'Cash', paymentStatus: 'NOT PAID', status: 'Pending',
  dateLabel: new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10), timestamp: Timestamp.fromDate(now),
});
for (let i = 0; i < 100 && !(await db.doc(`kds_orders/${ORDER_ID}`).get()).exists; i++) await sleep(100);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  let file = join(siteDir, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { ws, send };
}

const profileDir = mkdtempSync(join(tmpdir(), 'luna-staff-e2e-'));
const debugPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--hide-scrollbars', '--force-color-profile=srgb', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
const steps = [];
const errors = [];
const step = (name, data) => { steps.push({ step: name, ...data }); console.log(name, JSON.stringify(data)); };
try {
  let version;
  for (let i = 0; i < 80 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { await sleep(150); } }
  const browser = await cdp(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const s = await cdp(list.find((p) => p.id === targetId).webSocketDebuggerUrl);
  s.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console.error ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await s.send('Page.enable'); await s.send('Runtime.enable');
  // Icon glyphs are private-use characters; drop them from recorded text.
  const clean = (v) => (typeof v === 'string' ? v.replace(/[-\u{F0000}-\u{FFFFD}]/gu, '').trim() : Array.isArray(v) ? v.map(clean) : v);
  const evaluate = async (expression) => clean((await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value);
  const waitFor = async (expression, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expression).catch(() => false)) return Date.now() - t0; await sleep(150); } throw new Error(`timed out waiting for ${expression}`); };
  const shoot = async (name) => { const { data } = await s.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(data, 'base64')); return name; };
  const typePin = (pin) => evaluate(`(async () => { for (const d of ${JSON.stringify(pin.split(''))}) { document.querySelector('[data-digit="' + d + '"]').click(); await new Promise((r) => setTimeout(r, 60)); } document.querySelector('[data-submit]').click(); return true; })()`);

  await s.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/staff/` });
  await waitFor(`!!document.querySelector('[data-digit="1"]')`);

  await typePin('1111');
  await waitFor(`!!document.querySelector('.login__error')`);
  step('wrong PIN', { error: await evaluate(`document.querySelector('.login__error').textContent.trim()`), stillOnLogin: await evaluate(`!!document.querySelector('[data-digit]')`) });

  await typePin(PIN);
  const ms = await waitFor(`!!document.querySelector('.kact[data-id="${ORDER_ID}"]')`);
  const user = await getAuth().getUser('staff_anna');
  // The role claim rides in the custom token verifyStaff minted: read it from
  // the ID token the Auth SDK saved in IndexedDB.
  const tokenRole = await evaluate(`new Promise((ok) => { const o = indexedDB.open('firebaseLocalStorageDb'); o.onsuccess = () => { const q = o.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => { const row = q.result.find((r) => r.value?.uid === 'staff_anna'); const jwt = row?.value.stsTokenManager.accessToken ?? ''; try { ok(JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null); } catch { ok(null); } }; }; o.onerror = () => ok(null); })`);
  step('right PIN', {
    reachedKdsMs: ms,
    snack: await evaluate(`document.querySelector('.snack')?.textContent.trim() ?? null`),
    authUser: { uid: user.uid, tokenRole },
    login: await shoot('ts-staff-e2e-kds-pending-1440.png'),
  });

  for (const [label, to] of [['START PREPARING', 'Preparing'], ['MARK AS READY', 'Ready']]) {
    const btn = await evaluate(`(() => { const b = document.querySelector('.kact[data-id="${ORDER_ID}"]'); const t = b.textContent.trim(); b.click(); return t; })()`);
    let saved;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { saved = (await db.doc(`orders/${ORDER_ID}`).get()).data().status; if (saved === to) break; await sleep(150); }
    await waitFor(`!!document.querySelector('.kact[data-id="${ORDER_ID}"]') && !document.querySelector('.kact[data-id="${ORDER_ID}"]').disabled && document.querySelector('.kact[data-id="${ORDER_ID}"]').textContent.trim() !== ${JSON.stringify(btn)}`);
    await sleep(400);
    step(`tap ${label}`, {
      button: btn, expected: label, savedStatus: saved, mirrorStatus: (await db.doc(`kds_orders/${ORDER_ID}`).get()).data()?.status,
      nextButton: await evaluate(`document.querySelector('.kact[data-id="${ORDER_ID}"]').textContent.trim()`),
      snack: await evaluate(`document.querySelector('.snack')?.textContent.trim() ?? null`),
    });
  }
  step('board after', { screenshot: await shoot('ts-staff-e2e-kds-ready-1440.png') });

  // The same board on the tablet-sized viewport the kitchen actually uses.
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await evaluate(`(() => { const t = document.querySelector('[data-tab="2"]'); if (t) t.click(); return true; })()`);
  await sleep(400);
  step('board narrow', {
    screenshot: await shoot('ts-staff-e2e-kds-ready-390.png'),
    tabbed: await evaluate(`!!document.querySelector('.ktabs') && !document.querySelector('.kcol')`),
    cards: await evaluate(`[...document.querySelectorAll('.kact')].map((b) => b.dataset.id)`),
  });
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);

  await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/staff/dashboard` });
  await waitFor(`[...document.querySelectorAll('.stat__value')].some((v) => v.textContent !== '₱0' && v.textContent !== '0')`);
  await sleep(600);
  step('dashboard', {
    stats: await evaluate(`[...document.querySelectorAll('.stat')].map((c) => c.querySelector('.stat__label').textContent + ': ' + c.querySelector('.stat__value').textContent)`),
    welcome: await evaluate(`document.querySelector('.dhead__hi')?.textContent`),
    recent: await evaluate(`[...document.querySelectorAll('.otile__num')].map((n) => n.textContent)`),
    screenshot: await shoot('ts-staff-e2e-dashboard-1440.png'),
  });
  // Logout must clear the Auth row before leaving, or the kiosk still sees staff.
  await evaluate(`document.querySelector('.dhead__logout').click(), true`);
  await waitFor(`location.pathname === '/'`);
  await sleep(300);
  await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/kiosk/menu` });
  await waitFor(`document.readyState === 'complete'`);
  await sleep(800);
  step('logout', {
    landedOn: '/',
    staffRowsLeft: await evaluate(`new Promise((ok) => { const o = indexedDB.open('firebaseLocalStorageDb'); o.onsuccess = () => { const db = o.result; if (!db.objectStoreNames.contains('firebaseLocalStorage')) { ok(0); return; } const q = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => ok(q.result.filter((r) => String(r.value?.uid ?? '').startsWith('staff_')).length); }; o.onerror = () => ok(-1); })`),
    kioskOrdersButtonHidden: await evaluate(`document.querySelector('a.orders[data-staff]')?.hidden ?? null`),
  });
  await browser.send('Browser.close').catch(() => {});
} finally {
  chrome.kill();
  server.close();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}

writeFileSync(join(outDir, 'ts-staff-e2e.json'), JSON.stringify({ steps, errors }, null, 2) + '\n');
const ok = steps.find((x) => x.step === 'tap MARK AS READY')?.savedStatus === 'Ready' && steps.find((x) => x.step === 'wrong PIN')?.stillOnLogin && steps.find((x) => x.step === 'logout')?.staffRowsLeft === 0;
if (!ok) { console.error('staff e2e failed', errors); process.exit(1); }
