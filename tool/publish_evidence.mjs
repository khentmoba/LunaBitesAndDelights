// Publishes proof images to the `evidence` branch (an orphan branch holding only
// images) and prints a URL to embed for each, so screenshots never land on main.
// Also writes the markdown lines to `.evidence-urls.md` (gitignored) so URLs
// survive context handoffs.
//
//   node tool/publish_evidence.mjs docs/evidence/<shot>.png [...]
//   git ls-files docs/evidence | node tool/publish_evidence.mjs -   # paths on stdin
//
// A file under docs/evidence/ keeps its path; any other file goes to
// docs/evidence/<name>. Commits through a temporary index, so the working
// tree, the current branch and the real index are never touched.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'evidence';
const REPO = 'https://github.com/khentmoba/LunaBitesAndDelights';

export const url = (path) => `${REPO}/blob/${BRANCH}/${path}?raw=true`;

export function targetPath(file) {
  const rel = relative(root, file).split('\\').join('/');
  return rel.startsWith('docs/evidence/') ? rel : `docs/evidence/${basename(file)}`;
}

const git = (args, opts = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();

function publishOnce(entries) {
  const remote = `refs/remotes/origin/${BRANCH}`;
  const exists = git(['ls-remote', '--heads', 'origin', BRANCH]) !== '';
  if (exists) git(['fetch', '-q', 'origin', `+refs/heads/${BRANCH}:${remote}`]);
  const parent = exists ? git(['rev-parse', remote]) : '';
  const index = join(tmpdir(), `evidence-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(parent ? ['read-tree', parent] : ['read-tree', '--empty'], { env });
    git(['update-index', '--add', '--index-info'], { env, input: entries.map((e) => `100644 ${e.blob}\t${e.path}`).join('\n') });
    const tree = git(['write-tree'], { env });
    if (parent && tree === git(['rev-parse', `${parent}^{tree}`])) return parent;
    const msg = `evidence: ${entries.length} file(s) from ${git(['rev-parse', '--abbrev-ref', 'HEAD'])}`;
    const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', msg]);
    git(['push', '-q', 'origin', `${commit}:refs/heads/${BRANCH}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    return commit;
  } finally {
    rmSync(index, { force: true });
  }
}

function main(args) {
  const files = args[0] === '-' ? readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean) : args;
  if (!files.length) {
    console.error('usage: node tool/publish_evidence.mjs <image> [...] | -');
    return 2;
  }
  const entries = files.map((f) => ({ path: targetPath(f), blob: git(['hash-object', '-w', f]) }));
  // Another push can land between fetch and push; retry on the new tip.
  for (let attempt = 1; ; attempt++) {
    try {
      console.error(`${BRANCH} @ ${publishOnce(entries).slice(0, 7)}`);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  const lines = entries.map((e) => `![${basename(e.path)}](${url(e.path)})`);
  for (const line of lines) console.log(line);
  try {
    appendFileSync(join(root, '.evidence-urls.md'), `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Non-fatal if working tree is read-only.
  }
  return 0;
}

if (process.argv[1]?.endsWith('publish_evidence.mjs')) process.exitCode = main(process.argv.slice(2));
