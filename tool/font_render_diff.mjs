// Renders site/index.html and site/menu/index.html full-page at 320/390/768/1440
// with two versions of /fonts/bricolage.woff2 (same HTML), headless and muted,
// and writes <page>-<width>-{old,new}.png. Compare them with tool/png_diff.py.
// Used to prove tool/prune_kerning.py changes no rendered pixel.
//
//   node tool/font_render_diff.mjs site tool/fonts/bricolage-source.woff2 site/fonts/bricolage.woff2 <outDir>
//   python tool/png_diff.py <outDir>
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const [siteDir, oldFont, newFont, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
let fontFile = oldFont;
const server = createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p === '/fonts/bricolage.woff2') { res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'no-store' }); return res.end(readFileSync(fontFile)); }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(siteDir, p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const dbg = 9700 + (port % 200);
const profile = join(tmpdir(), `fontdiff-${process.pid}`);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let pages;
  for (let i = 0; i < 80 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); } catch { await sleep(150); } }
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pend.set(n, (m) => m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result)); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const css = `*,*::before,*::after{animation:none!important;transition:none!important}iframe{visibility:hidden!important}.slip--menu,.window,.slip--find,.close{content-visibility:visible!important}`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})` });
  const results = [];
  for (const page of ['/', '/menu/']) for (const [w, dpr] of [[320, 2], [390, 2], [768, 2], [1440, 1]]) for (const [tag, font] of [['old', oldFont], ['new', newFont]]) {
    fontFile = font;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: dpr, mobile: w < 700 });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}${page}` });
    await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: `document.fonts.ready.then(()=>{const f=[...document.fonts].find(f=>f.family.includes('Bricolage Grotesque'));return JSON.stringify({status:f&&f.status,h:document.documentElement.scrollHeight})})`, awaitPromise: true, returnByValue: true });
    const info = JSON.parse(r.result.value);
    await sleep(300);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: info.h, scale: 1 } });
    const name = `${page === '/' ? 'index' : 'menu'}-${w}-${tag}.png`;
    writeFileSync(join(outDir, name), Buffer.from(data, 'base64'));
    results.push({ name, ...info });
  }
  console.log(JSON.stringify(results));
  ws.close();
} finally {
  chrome.kill('SIGKILL'); server.close();
  await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
