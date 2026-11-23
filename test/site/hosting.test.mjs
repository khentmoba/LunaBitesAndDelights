import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/// Guards `firebase.json` against redirect loops and CSP/asset drift.
///
/// Production Firebase Hosting matches a redirect `source` with or without a
/// trailing slash, so `{"source": "/kiosk", "destination": "/kiosk/"}` also
/// matches `/kiosk/` and redirects it to itself. Safari then fails with "Load
/// cannot follow more than 20 redirections". The local emulator does not
/// reproduce this, so the rule is checked against the config itself.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const firebase = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));

/// Converts a Firebase Hosting glob (`*`, `**`, `{a,b}`) to a RegExp.
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      const alts = glob.slice(i + 1, end).split(',');
      out += `(?:${alts.map((a) => globToRegExp(a).source.slice(1, -1)).join('|')})`;
      i = end;
    } else {
      out += c.replace(/[.+?^$()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/// Every form of `path` that production Hosting may match: with and without a
/// trailing slash.
function slashVariants(path) {
  const bare = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return bare === '/' ? ['/'] : [bare, `${bare}/`];
}

function sourceMatches(redirect, path) {
  if (redirect.regex) return new RegExp(redirect.regex).test(path);
  return globToRegExp(redirect.source).test(path);
}

for (const site of firebase.hosting) {
  const name = site.target ?? site.site;
  for (const redirect of site.redirects ?? []) {
    const label = redirect.source ?? redirect.regex;
    test(`${name}: redirect ${label} does not loop`, () => {
      const dest = redirect.destination;
      if (/^https?:\/\//.test(dest)) return;
      const path = dest.split(/[?#]/)[0];
      for (const variant of slashVariants(path)) {
        assert.ok(
          !sourceMatches(redirect, variant),
          `${label} -> ${dest}: the destination ${variant} matches the source again, so production Hosting loops.`,
        );
      }
    });
  }
}

test('app-site serves /kiosk/ without an explicit redirect rule', () => {
  const app = firebase.hosting.find((h) => h.target === 'app-site');
  const kioskRedirects = (app.redirects ?? []).filter((r) =>
    slashVariants('/kiosk').some((p) => sourceMatches(r, p)),
  );
  assert.deepEqual(
    kioskRedirects,
    [],
    'Hosting already adds the trailing slash to /kiosk; a redirect rule here loops /kiosk/.',
  );
});

test('globToRegExp handles the patterns used in firebase.json', () => {
  assert.ok(globToRegExp('/menu{,/**}').test('/menu'));
  assert.ok(globToRegExp('/menu{,/**}').test('/menu/a/b'));
  assert.ok(globToRegExp('/kiosk').test('/kiosk'));
  assert.ok(!globToRegExp('/kiosk').test('/kiosk/x'));
  assert.ok(globToRegExp('/**').test('/anything'));
});

test('the loop check catches the rule that broke production', () => {
  const bad = { source: '/kiosk', destination: '/kiosk/', type: 301 };
  assert.ok(slashVariants(bad.destination).some((p) => sourceMatches(bad, p)));
});

function parseCsp(cspValue) {
  const directives = {};
  for (const raw of cspValue.split(';')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) directives[parts[0]] = parts.slice(1);
  }
  return directives;
}

function originAllowed(origin, sources = []) {
  for (const src of sources) {
    if (src === 'https:' && origin.startsWith('https://')) return true;
    if (src.startsWith('https://*.')) {
      const suffix = src.slice('https://*'.length); // e.g. .googleapis.com
      const host = origin.slice('https://'.length);
      if (host.endsWith(suffix) && host.length > suffix.length) return true;
    } else if (src === origin) {
      return true;
    }
  }
  return false;
}

function walkHtmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('app-site sets Content-Security-Policy and 30-day font cache headers', () => {
  const app = firebase.hosting.find((h) => h.target === 'app-site');
  const globalHeaders = app.headers.find((h) => h.source === '**')?.headers ?? [];
  const csp = globalHeaders.find((h) => h.key === 'Content-Security-Policy');
  assert.ok(csp && csp.value.includes("default-src 'self'") && csp.value.includes("object-src 'none'"));
  const frameSrc = csp.value.split(';').map((s) => s.trim()).find((d) => d.startsWith('frame-src ')) ?? '';
  assert.ok(frameSrc.includes('https://maps.google.com'), 'frame-src must allow the landing-page map iframe');
  assert.ok(frameSrc.includes('https://www.google.com'), 'frame-src must allow Street View and reCAPTCHA iframes');
  const woff2 = app.headers.find((h) => h.source === '**/*.woff2')?.headers ?? [];
  assert.ok(woff2.some((h) => h.key === 'Cache-Control' && h.value.includes('max-age=2592000')));
  const appHeaders = app.headers.find((h) => h.source === '{/staff,/staff/**,/kiosk,/kiosk/**,/payment,/payment/**}')?.headers ?? [];
  const appCsp = appHeaders.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
  const appScriptSrc = appCsp.split(';').map((s) => s.trim()).find((d) => d.startsWith('script-src ')) ?? '';
  assert.ok(appScriptSrc.includes("'self'") && !appScriptSrc.includes("'unsafe-inline'"), '/staff, /kiosk, and /payment CSP must not allow unsafe-inline scripts');
  assert.ok(appScriptSrc.includes('https://maps.googleapis.com'), 'the kiosk map loads the Maps JavaScript API');
  const appImgSrc = appCsp.split(';').map((s) => s.trim()).find((d) => d.startsWith('img-src ')) ?? '';
  assert.ok(appImgSrc.includes('https://maps.gstatic.com'), 'map tiles and markers come from gstatic');
  const appStyleSrc = appCsp.split(';').map((s) => s.trim()).find((d) => d.startsWith('style-src ')) ?? '';
  assert.ok(appStyleSrc.includes('https://fonts.googleapis.com'), 'the Maps widget loads its own stylesheet from Google Fonts');
  const appFontSrc = appCsp.split(';').map((s) => s.trim()).find((d) => d.startsWith('font-src ')) ?? '';
  assert.ok(appFontSrc.includes('https://fonts.gstatic.com'), 'Google Fonts serves the widget fonts from gstatic');
});

test('built HTML external origins and inline scripts match firebase.json CSP headers', () => {
  const buildDir = join(root, 'build', 'app');
  assert.ok(existsSync(buildDir), 'build/app missing — run `npm --prefix app run build` first');
  const app = firebase.hosting.find((h) => h.target === 'app-site');
  const globalCsp = parseCsp(
    app.headers.find((h) => h.source === '**').headers.find((h) => h.key === 'Content-Security-Policy').value,
  );
  const strictCsp = parseCsp(
    app.headers
      .find((h) => h.source === '{/staff,/staff/**,/kiosk,/kiosk/**,/payment,/payment/**}')
      .headers.find((h) => h.key === 'Content-Security-Policy').value,
  );

  const htmlFiles = walkHtmlFiles(buildDir);
  assert.ok(htmlFiles.length >= 12, `expected at least 12 built HTML files, found ${htmlFiles.length}`);

  for (const file of htmlFiles) {
    const rel = relative(buildDir, file).split('\\').join('/');
    const isStrictRoute = /^(kiosk|staff|payment)\//.test(rel);
    const csp = isStrictRoute ? strictCsp : globalCsp;
    const html = readFileSync(file, 'utf8');

    // Check external origins in <iframe src>, <script src>, <img src>, and <link rel="stylesheet" href>
    const checks = [
      { directive: 'frame-src', re: /<iframe\b[^>]*\bsrc=["'](https:\/\/[^"'/?#]+)/gi },
      { directive: 'script-src', re: /<script\b[^>]*\bsrc=["'](https:\/\/[^"'/?#]+)/gi },
      { directive: 'img-src', re: /<img\b[^>]*\bsrc=["'](https:\/\/[^"'/?#]+)/gi },
      {
        directive: 'style-src',
        re: /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["'](https:\/\/[^"'/?#]+)/gi,
      },
    ];
    for (const { directive, re } of checks) {
      for (const m of html.matchAll(re)) {
        const origin = m[1];
        assert.ok(
          originAllowed(origin, csp[directive]),
          `${rel}: external origin ${origin} is not permitted by ${directive} in firebase.json`,
        );
      }
    }

    // Strict routes (/kiosk/**, /staff/**, /payment/**) must not emit executable inline <script> or on*= handlers
    if (isStrictRoute) {
      for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = m[1];
        const body = m[2].trim();
        if (/\bsrc\s*=/.test(attrs)) continue;
        if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
        assert.equal(body, '', `${rel}: inline executable <script> violates strict script-src CSP`);
      }
      assert.equal(
        /\son[a-z]+\s*=/i.test(html),
        false,
        `${rel}: inline DOM event handler attribute violates strict script-src CSP`,
      );
    }
  }
});

test('every interactive kiosk page wires watchInactivity and staff sw.js asset prefixes exist', () => {
  const kioskPages = ['menu.astro', 'cart.astro', 'map.astro', 'checkout.astro', 'gcash.astro', 'receipt.astro'];
  for (const page of kioskPages) {
    const content = readFileSync(join(root, 'app', 'src', 'pages', 'kiosk', page), 'utf8');
    assert.ok(
      content.includes('watchInactivity'),
      `app/src/pages/kiosk/${page} must call watchInactivity()`,
    );
  }
  const sw = readFileSync(join(root, 'app', 'public', 'staff', 'sw.js'), 'utf8');
  assert.ok(sw.includes("'/kiosk/fonts/'"), 'staff sw.js should cache /kiosk/fonts/');
  assert.ok(existsSync(join(root, 'app', 'public', 'kiosk', 'fonts')), 'app/public/kiosk/fonts directory must exist');
});
