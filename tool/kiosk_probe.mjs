// Headless cold-load probe for the Flutter kiosk (/kiosk/).
//
// Serves a `flutter build web` output under /kiosk/ with the real
// firebase.json header rules and gzip, then loads it in headless Chrome
// (muted, no window) and records bytes on the wire, which renderer loaded,
// and time to Flutter's first frame. Google/Firebase APIs are blocked (the gstatic CanvasKit CDN is allowed) so the
// probe never talks to production and every build sees the same conditions.
//
//   node tool/kiosk_probe.mjs --build=build/web --label=after --runs=3 \
//     --out=docs/evidence/kiosk-perf-after.json [--shot=docs/evidence/x.png]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.split('=');
  return [k.replace(/^--/, ''), v.length ? v.join('=') : true];
}));
const buildDir = resolve(args.build ?? join(root, 'build', 'web'));
const label = args.label ?? 'kiosk';
const runs = Number(args.runs ?? 3);
const chromePath = args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.css': 'text/css; charset=utf-8', '.bin': 'application/octet-stream',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.json', '.wasm', '.css', '.otf', '.ttf', '.bin']);

function globToRegExp(glob) {
  const convert = (s) => {
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (c === '*') { if (s[i + 1] === '*') { out += '.*'; i += 1; } else out += '[^/]*'; }
      else if (c === '@' && s[i + 1] === '(') {
        let d = 1, j = i + 2; while (j < s.length && d > 0) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; }
        out += `(?:${s.slice(i + 2, j - 1).split('|').map(convert).join('|')})`; i = j - 1;
      } else if (c === '{') {
        let d = 1, j = i + 1; while (j < s.length && d > 0) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
        out += `(?:${s.slice(i + 1, j - 1).split(',').map(convert).join('|')})`; i = j - 1;
      } else if ('.+?^$()[]|\\'.includes(c)) out += `\\${c}`;
      else out += c;
    }
    return out;
  };
  return new RegExp(`^${convert(glob)}$`);
}
const hosting = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8')).hosting.find((h) => h.target === 'app-site');
const rules = hosting.headers.map((r) => ({ match: globToRegExp(r.source), headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])) }));
const headersFor = (p) => Object.assign({}, ...rules.filter((r) => r.match.test(p)).map((r) => r.headers));

const gzCache = new Map();
const server = createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (!p.startsWith('/kiosk/')) { res.writeHead(404); res.end(); return; }
  let rel = p.slice('/kiosk/'.length) || 'index.html';
  let file = join(buildDir, normalize(rel));
  if (!file.startsWith(buildDir) || !existsSync(file) || !statSync(file).isFile()) {
    file = join(buildDir, 'index.html'); rel = 'index.html'; // SPA rewrite
  }
  const ext = extname(file);
  const gzip = COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  let body = readFileSync(file);
  if (gzip) body = gzCache.get(file) ?? gzCache.set(file, gzipSync(body, { level: 9 })).get(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    ...headersFor(p),
    ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  res.end(body);
});

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { ws, send, events };
}

const FIRST_FRAME = `window.__ff = null; window.addEventListener('flutter-first-frame', () => { window.__ff = performance.now(); });`;
const PROFILES = {
  fast4g: { label: '4G: 4 Mbps down, 1.5 Mbps up, 100 ms RTT, 4x CPU', latency: 100, down: 4e6 / 8, up: 1.5e6 / 8, cpu: 4 },
  wifi: { label: 'unthrottled, 1x CPU', latency: 0, down: -1, up: -1, cpu: 1 },
};

async function coldLoad(s, port, profile) {
  s.events.length = 0;
  await s.send('Network.clearBrowserCache');
  await s.send('Network.clearBrowserCookies');
  await s.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${port}`, storageTypes: 'all' });
  await s.send('Network.setCacheDisabled', { cacheDisabled: false });
  await s.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up });
  await s.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/kiosk/` });
  let ff = null;
  const deadline = Date.now() + 120000;
  while (ff === null && Date.now() < deadline) {
    await sleep(200);
    try { ff = (await s.send('Runtime.evaluate', { expression: 'window.__ff', returnByValue: true })).result.value ?? null; } catch { /* navigating */ }
  }
  await sleep(1500);
  const finished = new Map(s.events.filter((e) => e.method === 'Network.loadingFinished').map((e) => [e.params.requestId, e.params.encodedDataLength]));
  const reqs = s.events.filter((e) => e.method === 'Network.requestWillBeSent' && /127.0.0.1|gstatic.com/.test(e.params.request.url))
    .map((e) => ({ url: new URL(e.params.request.url).host.includes('gstatic') ? 'gstatic:' + new URL(e.params.request.url).pathname.split('/').pop() : new URL(e.params.request.url).pathname, bytes: finished.get(e.params.requestId) ?? 0 }));
  const uniq = [...new Map(reqs.map((r) => [r.url, r])).values()];
  const timeline = JSON.parse((await s.send('Runtime.evaluate', {
    expression: `JSON.stringify(performance.getEntriesByType('resource').map((r) => [Math.round(r.startTime), Math.round(r.responseEnd), r.name.split('?')[0].split('/').slice(-2).join('/')]))`,
    returnByValue: true,
  })).result.value);
  const env = (await s.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ crossOriginIsolated: self.crossOriginIsolated, renderer: window._flutter?.buildConfig?.builds?.map(b => b.compileTarget + ":" + (b.renderer||"")) })',
    returnByValue: true,
  })).result.value;
  return {
    firstFrameMs: ff === null ? null : Math.round(ff),
    bytesOnWire: uniq.reduce((n, r) => n + r.bytes, 0),
    requests: uniq.length,
    urls: uniq.map((r) => `${r.url} ${r.bytes}`),
    timeline,
    blocked: [...new Set(s.events.filter((e) => e.method === 'Network.loadingFailed' && e.params.blockedReason)
      .map((e) => s.events.find((x) => x.method === 'Network.requestWillBeSent' && x.params.requestId === e.params.requestId)?.params.request.url.split('?')[0]))],
    engine: uniq.filter((r) => /\.(wasm|mjs)$|canvaskit|skwasm|wimp|main\.dart/.test(r.url)).map((r) => `${r.url} ${r.bytes}`),
    env: JSON.parse(env),
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

let chrome; const profileDir = join(tmpdir(), `luna-kiosk-probe-${process.pid}`);
try {
  if (!existsSync(join(buildDir, 'index.html'))) throw new Error(`No index.html in ${buildDir}`);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const debugPort = 9700 + (port % 200);
  chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-sandbox',
    '--enable-unsafe-swiftshader', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
  let pages;
  for (let i = 0; i < 80 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); } catch { await sleep(150); } }
  const s = await cdp(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await s.send('Page.enable'); await s.send('Runtime.enable'); await s.send('Network.enable');
  // CDP throttling stalls behind the kiosk's network-first service worker;
  // bypass it so every build is measured on the same direct path.
  await s.send('Network.setBypassServiceWorker', { bypass: true });
  await s.send('Network.setBlockedURLs', { urls: ['*googleapis.com*', '*firebaseio.com*', '*google.com*', '*firebaseapp.com*', '*cloudfunctions.net*', '*maptiler*'] });
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: FIRST_FRAME });

  await coldLoad(s, port, PROFILES.wifi); // warm-up: the first navigation in a fresh profile is not representative
  const result = { label, build: buildDir.replace(/\\/g, '/'), capturedAt: new Date().toISOString(), viewport: '390x844@2x', note: 'gzip -9 on html/js/mjs/wasm/json; service worker bypassed; Google/Firebase APIs blocked; CanvasKit from gstatic counted', profiles: {} };
  for (const [name, profile] of Object.entries(PROFILES)) {
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await coldLoad(s, port, profile));
    result.profiles[name] = {
      profile: profile.label,
      medianFirstFrameMs: median(samples.map((x) => x.firstFrameMs ?? Infinity)),
      medianBytesOnWire: median(samples.map((x) => x.bytesOnWire)),
      samples,
    };
  }
  if (args.shot) {
    await s.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await s.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(2500);
    const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(resolve(args.shot)), { recursive: true });
    writeFileSync(resolve(args.shot), Buffer.from(data, 'base64'));
  }
  if (args.out) { mkdirSync(dirname(resolve(args.out)), { recursive: true }); writeFileSync(resolve(args.out), JSON.stringify(result, null, 2) + '\n'); }
  console.log(JSON.stringify({ label, ...Object.fromEntries(Object.entries(result.profiles).map(([k, v]) => [k, { firstFrameMs: v.medianFirstFrameMs, bytes: v.medianBytesOnWire, engine: v.samples[0].engine, env: v.samples[0].env }])) }, null, 1));
  s.ws.close();
} finally {
  if (chrome) chrome.kill('SIGKILL');
  server.close();
  for (let i = 0; i < 5; i++) { try { rmSync(profileDir, { recursive: true, force: true }); break; } catch { await sleep(400); } }
}
