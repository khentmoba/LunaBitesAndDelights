// Checks that the cutover's /kiosk/ service worker retires the Flutter one.
// In headless muted Chrome, for each path Flutter registered a worker at:
//   1. serve a stand-in Flutter worker that caches the app, register it and
//      fill its cache, as a device that ran the Flutter kiosk would have;
//   2. swap in the built file from build/app (what the deploy serves);
//   3. reload, and check the worker is gone, the Flutter cache is gone,
//      and a staff PWA cache survives.
// The test page is a blank page under /kiosk/, so nothing talks to Firebase.
//
//   npm run build --prefix app && node tool/parity/sw_retire.mjs --out=docs/evidence
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.split('='); return [k.replace(/^--/, ''), v.join('=') || true]; }));
const siteDir = resolve(args.site ?? join(root, 'build', 'app'));
const outDir = resolve(args.out ?? join(root, 'docs', 'evidence'));
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LEGACY = `
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open('flutter-app-cache').then((c) => c.put('/kiosk/main.dart.js', new Response('flutter')))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.mode === 'navigate') e.respondWith(fetch(e.request)); });
`;
const PAGE = '<!doctype html><title>sw test</title><script></script>';

let phase = 'flutter';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/kiosk/sw-test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  const m = path.match(/^\/kiosk\/(sw|flutter_service_worker)\.js$/);
  if (m) {
    const body = phase === 'flutter' ? LEGACY : readFileSync(join(siteDir, 'kiosk', `${m[1]}.js`));
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { ws, send };
}

const profileDir = mkdtempSync(join(tmpdir(), 'luna-sw-retire-'));
const debugPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
const results = [];
let failed = false;
try {
  let version;
  for (let i = 0; i < 80 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { await sleep(150); } }
  const browser = await cdp(version.webSocketDebuggerUrl);
  for (const script of ['flutter_service_worker.js', 'sw.js']) {
    phase = 'flutter';
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => new Promise((r, j) => {
      const n = Math.floor(Math.random() * 1e9);
      const onMsg = (e) => { const m = JSON.parse(e.data); if (m.id === n) { browser.ws.removeEventListener('message', onMsg); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } };
      browser.ws.addEventListener('message', onMsg);
      browser.ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
    const state = () => evaluate(`(async () => ({ workers: (await navigator.serviceWorker.getRegistrations()).map((r) => (r.active || r.waiting || r.installing)?.scriptURL ?? null), caches: (await caches.keys()).sort() }))()`);

    await send('Page.enable');
    await send('Page.navigate', { url: `${origin}/kiosk/sw-test.html` });
    await sleep(800);
    await evaluate(`navigator.serviceWorker.register('/kiosk/${script}', { scope: '/kiosk/' }).then(() => navigator.serviceWorker.ready)`);
    await evaluate(`caches.open('luna-staff-v1').then((c) => c.put('/staff/', new Response('staff')))`);
    for (let i = 0; i < 20; i++) { const s = await state(); if (s.caches.includes('flutter-app-cache')) break; await sleep(150); }
    const before = await state();

    phase = 'ts';
    await send('Page.navigate', { url: `${origin}/kiosk/sw-test.html` });
    let after;
    for (let i = 0; i < 40; i++) { await sleep(250); after = await state().catch(() => null); if (after && after.workers.length === 0 && !after.caches.includes('flutter-app-cache')) break; }
    await sleep(800);
    after = await state();
    const ok = before.workers.length === 1 && before.caches.includes('flutter-app-cache') && after.workers.length === 0 && !after.caches.includes('flutter-app-cache') && after.caches.includes('luna-staff-v1');
    if (!ok) failed = true;
    const row = { script: `/kiosk/${script}`, before: { workers: before.workers.map((u) => new URL(u).pathname), caches: before.caches }, after: { workers: after.workers, caches: after.caches }, pass: ok };
    results.push(row);
    console.log(JSON.stringify(row));
    await evaluate(`(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); })()`);
    await browser.send('Target.closeTarget', { targetId });
  }
  await browser.send('Browser.close').catch(() => {});
} finally {
  chrome.kill();
  server.close();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
writeFileSync(join(outDir, 'ts-cutover-sw-retire.json'), `${JSON.stringify({ chrome: 'headless=new, muted', results }, null, 2)}\n`);
if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
