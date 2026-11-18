// Every repo path named in a live doc or code comment must exist, so a moved or
// deleted file cannot leave a pointer that sends the next agent nowhere.
// History is exempt: specs/, review and critique packets, evidence write-ups,
// and paths into the deleted Flutter tree (*.dart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HISTORY = /^(specs|\.specify|\.agent|docs\/evidence|\.impeccable\/(review|critique|mocks))\//;
const CODE = /^(app\/src|functions\/(src|scripts|test)|tool|test|\.github)\/.*\.(ts|mjs|js|cjs|astro|ya?ml)$/;
const BUILD_OUTPUT = /^(functions\/lib|build|app\/dist)\//;
const PATH = /(?<![\w/.@-])((?:app|functions|tool|test|docs|scripts|specs|legacy-redirect|\.github|\.impeccable)\/[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]+)/g;

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !HISTORY.test(f) && (f.endsWith('.md') || CODE.test(f)));

// A path may be written from the repo root, the file's own folder, or its package (app/, functions/).
function exists(path, from) {
  const pkg = /^(app|functions)\//.exec(from)?.[1];
  return [root, join(root, dirname(from)), pkg && join(root, pkg)].some((base) => base && existsSync(join(base, path)));
}

test('paths named in docs and comments exist', () => {
  const missing = [];
  for (const f of files) {
    readFileSync(join(root, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(PATH)) {
        const p = m[1].replace(/\.+$/, '');
        if (p.endsWith('.dart') || BUILD_OUTPUT.test(p) || exists(p, f)) continue;
        missing.push(`${f}:${i + 1} -> ${p}`);
      }
    });
  }
  assert.ok(files.length > 50, `scanned only ${files.length} files`);
  assert.deepEqual(missing, [], `dangling path references:\n${missing.join('\n')}`);
});
