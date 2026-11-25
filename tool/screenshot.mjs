// Screenshots a page in headless Chrome at an exact CSS viewport, which
// --window-size cannot do on Windows (the OS clamps windows to ~500px wide).
//   node tool/screenshot.mjs <url> <width> <height> <out.png> [waitMs]
//   node tool/screenshot.mjs --serve <dir> <path> <width> <height> <out.png> [waitMs]
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function freePort() {
  const srv = createNetServer();
  await new Promise((resolveFn, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolveFn);
  });
  const port = srv.address().port;
  await new Promise((resolveFn) => srv.close(resolveFn));
  return port;
}

async function startStaticServer(rootDir) {
  const root = resolve(rootDir);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const server = createHttpServer((req, res) => {
    let reqPath;
    try {
      reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }
    const candidate = resolve(root, `.${reqPath.startsWith('/') ? reqPath : `/${reqPath}`}`);
    if (candidate !== root && !candidate.startsWith(rootPrefix)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let targetPath = candidate;
    if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
      targetPath = join(targetPath, 'index.html');
    }
    if (!existsSync(targetPath) || statSync(targetPath).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const contentType = MIME[extname(targetPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(readFileSync(targetPath));
  });
  await new Promise((resolveFn, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveFn);
  });
  return { server, port: server.address().port };
}

const rawArgs = process.argv.slice(2);
let serveDir = null;
let positional = rawArgs;
if (rawArgs[0] === '--serve') {
  serveDir = rawArgs[1];
  positional = rawArgs.slice(2);
} else if (rawArgs[0]?.startsWith('--serve=')) {
  serveDir = rawArgs[0].slice('--serve='.length);
  positional = rawArgs.slice(1);
}

const [targetArg, width = '390', height = '844', out = 'shot.png', waitMs = '8000'] = positional;
if (!targetArg) {
  console.error('Usage: node tool/screenshot.mjs [--serve <dir>] <url-or-path> [width] [height] [out.png] [waitMs]');
  process.exit(2);
}
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = await freePort();
const profile = join(tmpdir(), `shot-profile-${process.pid}-${Date.now()}`);

let staticServer = null;
let url = targetArg;
if (serveDir) {
  const started = await startStaticServer(serveDir);
  staticServer = started.server;
  const routePath = targetArg?.startsWith('/') ? targetArg : `/${targetArg ?? ''}`;
  url = `http://127.0.0.1:${started.port}${routePath}`;
}

const child = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no debuggable page');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  const done = pending.get(msg.id);
  if (done) {
    pending.delete(msg.id);
    done(msg);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width),
    height: Number(height),
    deviceScaleFactor: 1,
    mobile: Number(width) < 700,
  });
  await send('Page.navigate', { url });
  await sleep(Number(waitMs));
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`${out} ${width}x${height}`);
} finally {
  ws.close();
  child.kill();
  if (staticServer) staticServer.close();
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(250);
    }
  }
}
