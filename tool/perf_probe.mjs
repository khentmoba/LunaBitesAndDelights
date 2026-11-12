// Headless performance probe for the static storefront.
//
// Serves site/ over localhost with the real firebase.json header rules, then
// drives Chrome over CDP with a slow-3G network and a 4x CPU slowdown. It
// records cold-load and repeat-visit bytes, paint timings, long tasks, and
// renders screenshots at the viewports the storefront supports.
//
//   node tool/perf_probe.mjs --label before --out docs/evidence/perf-before.json
//
// Chrome runs --headless=new with audio muted; no window is opened and the
// browser is killed before the process exits.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k.replace(/^--/, ''), v ?? true];
  }),
);
const label = args.label ?? 'probe';
const outFile = args.out ?? join(root, 'docs', 'evidence', `perf-${label}.json`);
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const siteDir = args.site ?? join(root, 'site');
const firebasePath = args.firebase ?? join(root, 'firebase.json');
const evidenceDir = join(root, 'docs', 'evidence');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`Cannot read ${path}: ${error.message}`); }
}

function pathOf(url) {
  try { return new URL(url, 'http://localhost').pathname; }
  catch { return String(url); }
}

function parseJson(text, fallback = {}) {
  try { return JSON.parse(text); }
  catch { return fallback; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};

// Firebase Hosting applies matching header rules in declaration order.
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i += 1; } else { out += '[^/]*'; }
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      out += `(?:${glob.slice(i + 1, end).split(',').join('|')})`;
      i = end;
    } else if ('.+?^$()[]|\\'.includes(c)) {
      out += `\\${c}`;
    } else out += c;
  }
  return new RegExp(`^${out}$`);
}

const hosting = readJson(firebasePath)
  .hosting.find((h) => h.target === 'app-site');
const headerRules = (hosting.headers ?? []).map((r) => ({
  match: r.regex ? new RegExp(r.regex) : globToRegExp(r.source),
  headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])),
}));

function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules) {
    if (rule.match.test(pathname)) Object.assign(out, rule.headers);
  }
  return out;
}

function resolveFile(pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  if (p.endsWith('/')) p += 'index.html';
  const rel = normalize(p).replace(/^([/\\])+/, '').replace(/\\/g, '/');
  const full = join(siteDir, rel);
  return full.startsWith(normalize(siteDir)) && existsSync(full) && statSync(full).isFile() ? full : null;
}

const server = createServer((req, res) => {
  const pathname = pathOf(req.url);
  const file = resolveFile(pathname);
  if (!file) { res.writeHead(404); res.end('not found'); return; }
  const raw = readFileSync(file);
  const type = extname(file);
  const compressible = ['.html', '.css', '.js', '.json', '.svg', '.txt'].includes(type);
  const gzip = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  const payload = gzip ? gzipSync(raw, { level: 9 }) : raw;
  const etag = `"${createHash('sha1').update(payload).digest('hex')}"`;
  const headers = {
    'Content-Type': MIME[type] ?? 'application/octet-stream',
    ETag: etag,
    ...headersFor(pathname),
  };
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  // Firebase Hosting's default for extensionless static routes is max-age=3600.
  if (!headers['Cache-Control'] && MIME[type] === 'text/html; charset=utf-8') {
    headers['Cache-Control'] = 'max-age=3600';
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const msg = parseJson(e.data, null);
    if (!msg) return;
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  return { ws, send, events };
}

const OBSERVERS = `
window.__perf = { lcp: 0, lcpEl: '', cls: 0, fcp: 0, tbt: 0, longTasks: 0 };
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.startTime > window.__perf.lcp) {
        window.__perf.lcp = e.startTime;
        window.__perf.lcpEl = e.element ? (e.element.tagName + (e.element.id ? '#' + e.element.id : '')) : '';
      }
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) { window.__perf.longTasks++; window.__perf.tbt += Math.max(0, e.duration - 50); }
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
} catch (e) { window.__perf.error = String(e); }
`;

async function measure({ send, events }, { width, height, dpr, throttle, clearCache = false }) {
  events.length = 0;
  await send('Network.enable');
  if (clearCache) await send('Network.clearBrowserCache');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: false });
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: width < 700,
  });
  if (throttle) {
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 400,
      downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8,
      connectionType: 'cellular3g',
    });
    await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  } else {
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  const deadline = Date.now() + 60000;
  while (!events.some((e) => e.method === 'Page.loadEventFired') && Date.now() < deadline) await sleep(100);
  await sleep(throttle ? 2500 : 900);

  const evaluated = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      ...window.__perf,
      domNodes: document.querySelectorAll('*').length,
      title: document.title,
      h1: document.querySelector('h1')?.textContent ?? null,
      font: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).fontFamily : null,
      sheets: document.styleSheets.length,
      resources: performance.getEntriesByType('resource').map(r => ({
        name: new URL(r.name).pathname, transferSize: r.transferSize,
        encodedBodySize: r.encodedBodySize, duration: Math.round(r.duration),
      })),
      nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return {
        responseEnd: Math.round(n.responseEnd), domContentLoaded: Math.round(n.domContentLoadedEventEnd),
        load: Math.round(n.loadEventEnd) }; })(),
    })`,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
  const perf = evaluated.result.value;

  const network = events
    .filter((e) => e.method === 'Network.responseReceived')
    .map((e) => ({
      url: pathOf(e.params.response.url),
      status: e.params.response.status,
      fromCache: Boolean(e.params.response.fromDiskCache || e.params.response.fromPrefetchCache),
      mimeType: e.params.type,
    }));
  const finished = new Map(events
    .filter((e) => e.method === 'Network.loadingFinished')
    .map((e) => [e.params.requestId, e.params.encodedDataLength]));
  const started = events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => ({ id: e.params.requestId, url: pathOf(e.params.request.url) }));

  const parsed = parseJson(perf);
  parsed.bytesOnWire = started.reduce((sum, r) => sum + (finished.get(r.id) ?? 0), 0);
  parsed.requests = network.length;
  parsed.conditionalRequests = network.filter((r) => r.status === 304).length;
  parsed.cachedRequests = network.filter((r) => r.fromCache).length;
  parsed.fullResponses = network.filter((r) => r.status === 200).length;
  parsed.statusByUrl = network.map((r) => `${r.status} ${r.url}`).sort();
  return parsed;
}

async function screenshot({ send }, { width, height, dpr, name, scrollTo, hash }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: width < 700,
  });
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await send('Page.navigate', {
    url: 'http://127.0.0.1:' + server.address().port + '/' + (hash ?? ''),
  });
  await sleep(1600);
  if (scrollTo && !hash) {
    await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(scrollTo)});
        const y = el.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top: y, behavior: 'instant' }); return y; })()`,
    });
    await sleep(700);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(evidenceDir, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

let chrome;
try {
  mkdirSync(evidenceDir, { recursive: true });
  if (!resolveFile('/')) throw new Error(`No site/index.html under ${siteDir}`);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const debugPort = 9400 + (port % 300);
  const profile = join(tmpdir(), `luna-perf-probe-${process.pid}`);
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--no-sandbox',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let version;
  for (let i = 0; i < 80; i += 1) {
    try { version = parseJson(await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).text(), null); if (version) break; }
    catch { await sleep(0); }
    await sleep(150);
  }
  if (!version) throw new Error('Chrome DevTools did not start');
  const pages = parseJson(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).text(), []);
  const page = pages.find((p) => p.type === 'page');
  const session = await cdp(page.webSocketDebuggerUrl);
  await session.send('Page.enable');
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVERS });

  const mobile = { width: 390, height: 844, dpr: 2 };
  const cold = await measure(session, { ...mobile, throttle: true });
  const warm = await measure(session, { ...mobile, throttle: true });
  const desktopCold = await measure(session, { width: 1440, height: 900, dpr: 1, throttle: true, clearCache: true });

  const shots = [];
  const takeShots = args.screenshots === true || args.screenshots === 'true';
  if (takeShots) {
    for (const [w, h, dpr, tag] of [[320, 720, 2, '320'], [390, 844, 2, '390'], [768, 900, 2, '768'], [1440, 900, 1, '1440']]) {
      shots.push(await screenshot(session, { width: w, height: h, dpr, name: `low-end-${label}-${tag}-top.png` }));
      shots.push(await screenshot(session, {
        width: w, height: h, dpr, name: `low-end-${label}-${tag}-menu.png`, scrollTo: '#board',
      }));
      shots.push(await screenshot(session, {
        width: w, height: h, dpr, name: `low-end-${label}-${tag}-photos.png`, hash: '#window',
      }));
    }
  }

  const samplePaths = ['/', '/menu/', '/styles.css', '/app.js', '/img/luna-logo-640.webp', '/fonts/bricolage.woff2', '/kiosk/main.dart.js'];
  const result = {
    label, capturedAt: new Date().toISOString(),
    cacheControl: Object.fromEntries(samplePaths.map((p) => [
      p, headersFor(p)['Cache-Control'] ?? '(Firebase default: max-age=3600)',
    ])),
    url: `http://127.0.0.1:${port}/`,
    profile: 'slow 3G: 400 kbps down/up, 400 ms RTT, 4x CPU slowdown',
    viewports: { mobile: '390x844@2x', desktop: '1440x900@1x' },
    cold, warm, desktopCold,
    screenshots: takeShots
      ? shots.map((s) => s.replace(/\\/g, '/').replace(root.replace(/\\/g, '/') + '/', ''))
      : [],
    headerRules: hosting.headers.map((h) => h.source ?? h.regex),
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({
    label, cold: { fcp: cold.fcp, lcp: cold.lcp, cls: cold.cls, tbt: cold.tbt, bytes: cold.bytesOnWire, requests: cold.requests },
    warm: { fcp: warm.fcp, lcp: warm.lcp, bytes: warm.bytesOnWire, requests: warm.requests, from304: warm.conditionalRequests, fromCache: warm.cachedRequests },
    desktop: { fcp: desktopCold.fcp, lcp: desktopCold.lcp, bytes: desktopCold.bytesOnWire },
  }, null, 2));
  session.ws.close();
} finally {
  if (chrome) chrome.kill('SIGKILL');
  server.close();
  for (let i = 0; i < 5; i += 1) {
    try { rmSync(join(tmpdir(), `luna-perf-probe-${process.pid}`), { recursive: true, force: true }); break; }
    catch { await sleep(400); }
  }
}
