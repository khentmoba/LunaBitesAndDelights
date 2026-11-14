import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/// Guards `firebase.json` against redirect loops.
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
