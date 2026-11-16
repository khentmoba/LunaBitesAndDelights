// End-to-end kiosk order: a shopper fills in checkout in headless muted
// Chrome, the TypeScript kiosk writes the order through firestore.rules on the
// emulator and calls sendOrderNotification, and the receipt shows it.
//
//   PUBLIC_FIREBASE_EMULATORS=1 npm run build --prefix app
//   cd functions && npx firebase-tools emulators:exec --project demo-lunaexpress \
//     --only auth,firestore,functions "node ../tool/parity/order_e2e.mjs --out=../docs/evidence"
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
const { getFirestore } = require('firebase-admin/firestore');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.split('='); return [k.replace(/^--/, ''), v.join('=') || true]; }));
const siteDir = resolve(args.site ?? join(root, 'build', 'app'));
const outDir = resolve(args.out ?? join(root, 'docs', 'evidence'));
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Run inside emulators:exec with a demo- project');

const db = getFirestore(initializeApp({ projectId: process.env.GCLOUD_PROJECT }));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  let file = join(siteDir, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
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

const CART = [
  { id: 'sm3', name: 'S3 – Shawarma Rice', emoji: '', imageUrl: 'images/sulit_shawarma.webp', variant: '', price: 99, quantity: 2 },
  { id: 'mc1', name: 'Milo Craze', emoji: '', imageUrl: '', variant: 'Oreo', price: 65, quantity: 1 },
];
const RUNS = [
  { name: 'pickup-cash', type: 'Pickup', draft: null },
  {
    name: 'delivery-cash', type: 'Delivery',
    // What the map page leaves behind after CONFIRM LOCATION.
    draft: { name: '', phone: '', address: 'Purok 5, Poblacion, Magallanes, Agusan del Norte', orderType: 'Delivery', paymentMethod: 'Cash', lat: 9.0212, lng: 125.5181, pinned: true, distance: 0.13, pendingDocId: null, pendingNumber: null },
  },
];

const profileDir = mkdtempSync(join(tmpdir(), 'luna-e2e-'));
const debugPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--hide-scrollbars', '--force-color-profile=srgb', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
const results = [];
try {
  let version;
  for (let i = 0; i < 80 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { await sleep(150); } }
  const browser = await cdp(version.webSocketDebuggerUrl);

  for (const run of RUNS) {
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const s = await cdp(list.find((p) => p.id === targetId).webSocketDebuggerUrl);
    const errors = [];
    s.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    });
    await s.send('Page.enable'); await s.send('Runtime.enable');
    const evaluate = async (expression) => (await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    // Seed once, as the menu and map pages would have left the session.
    const seed = [`sessionStorage.setItem('luna.cart', ${JSON.stringify(JSON.stringify(CART))});`];
    if (run.draft) seed.push(`sessionStorage.setItem('luna.checkout', ${JSON.stringify(JSON.stringify(run.draft))});`);
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!sessionStorage.getItem('e2e.seeded')) { ${seed.join('')} sessionStorage.setItem('e2e.seeded', '1'); }` });
    await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/kiosk/checkout` });
    for (let i = 0; i < 100 && (await evaluate(`document.readyState`)) !== 'complete'; i++) await sleep(100);
    await sleep(500);

    // Type like a shopper: the order type, then name and phone, then CONFIRM.
    await evaluate(`(() => {
      document.querySelector('[data-group="type"][data-value="${run.type}"]').click();
      document.querySelector('[data-group="pay"][data-value="Cash"]')?.click();
      const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('input[name=name]', 'Ana Reyes');
      set('input[name=phone]', '0917 123 4567');
      return true;
    })()`);
    await sleep(200);
    const button = await evaluate(`document.querySelector('[data-confirm]').textContent.trim()`);
    const t0 = Date.now();
    await evaluate(`document.querySelector('[data-confirm]').click(), true`);
    let path = '';
    while (Date.now() - t0 < 30000 && path !== '/kiosk/receipt') { await sleep(200); path = await evaluate('location.pathname').catch(() => ''); }
    const elapsed = Date.now() - t0;
    await sleep(1500);
    const receipt = await evaluate(`({
      headline: document.querySelector('[data-headline]')?.textContent,
      number: document.querySelector('[data-number]')?.textContent,
      rows: [...document.querySelectorAll('.rc-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()),
      total: document.querySelector('[data-total]')?.textContent,
      snack: document.querySelector('.snack')?.textContent?.trim() ?? null,
      cartLeft: sessionStorage.getItem('luna.cart'),
      draftLeft: sessionStorage.getItem('luna.checkout'),
    })`);
    const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
    const shot = `ts-kiosk-order-e2e-${run.name}-390.png`;
    writeFileSync(join(outDir, shot), Buffer.from(data, 'base64'));

    const orderId = receipt.number?.replace('ORDER # ', '');
    const snap = orderId ? await db.collection('orders').where('orderId', '==', orderId).get() : null;
    const doc = snap?.docs[0];
    const saved = doc ? { id: doc.id, ...doc.data(), timestamp: doc.data().timestamp?.toDate().toISOString() } : null;
    results.push({ run: run.name, button, reachedReceipt: path === '/kiosk/receipt', elapsedMs: elapsed, receipt, saved, screenshot: shot, errors });
    s.ws.close();
    await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
  await browser.send('Browser.close').catch(() => {});
} finally {
  chrome.kill();
  server.close();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}

const out = join(outDir, 'ts-kiosk-order-e2e.json');
writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.reachedReceipt || !r.saved)) process.exit(1);
