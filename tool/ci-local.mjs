// Runs the `run:` steps of .github/workflows/pr-checks.yml locally, in the
// same working directories and order, so a local pass means the same checks
// CI runs. Reads the workflow itself, so the two cannot drift.
//
//   npm run ci                         # every job (writes docs/evidence/ci-local.txt)
//   npm run ci -- --job=site,functions # some jobs (does not dirty docs/evidence/ci-local.txt)
//   npm run ci -- --no-evidence        # skip writing docs/evidence/ci-local.txt
//   npm run ci -- --no-install         # force-skip `npm ci` steps
//   npm run ci -- --install            # force-run `npm ci` steps even if node_modules is current
//   npm run ci -- --setup-only         # ensure node_modules installed in ., app, functions
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/pr-checks.yml';

// GitHub runs `run:` with bash; on Windows use Git's bash, not WSL's.
const bash =
  process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';

/** True when <dir>/node_modules/.package-lock.json exists and is at least as new as <dir>/package-lock.json. */
export function isDepsCurrent(dir) {
  const lock = join(root, dir, 'package-lock.json');
  const marker = join(root, dir, 'node_modules', '.package-lock.json');
  if (!existsSync(lock) || !existsSync(marker)) return false;
  try {
    return statSync(marker).mtimeMs >= statSync(lock).mtimeMs - 1000;
  } catch {
    return false;
  }
}

function ensureRootDeps() {
  if (existsSync(join(root, 'node_modules', 'yaml'))) return;
  console.log('▶ Bootstrapping root node_modules (npm ci)...');
  execFileSync(bash, ['-c', 'npm ci --no-audit --no-fund'], { cwd: root, stdio: 'inherit' });
}

ensureRootDeps();
const { parse } = await import('yaml');

/** Every `run:` step per job, with the directory CI runs it in. */
export function loadSteps(file = join(root, WORKFLOW)) {
  const wf = parse(readFileSync(file, 'utf8'));
  return Object.entries(wf.jobs).map(([job, def]) => ({
    job,
    steps: (def.steps ?? [])
      .filter((s) => s.run)
      .map((s) => ({
        name: s.name ?? s.run.split('\n')[0],
        run: s.run,
        cwd: s['working-directory'] ?? def.defaults?.run?.['working-directory'] ?? '.',
      })),
    setup: (def.steps ?? [])
      .filter((s) => s.uses)
      .map((s) => ({ uses: s.uses.split('@')[0], with: s.with ?? {} })),
  }));
}

function runStep(cmd, cwd) {
  return new Promise((done) => {
    const tail = [];
    const keep = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) tail.push(line);
      tail.splice(0, Math.max(0, tail.length - 25));
    };
    const p = spawn(bash, ['-c', cmd], { cwd: join(root, cwd), env: { ...process.env, CI: '1' } });
    p.stdout.on('data', (c) => (process.stdout.write(c), keep(c)));
    p.stderr.on('data', (c) => (process.stderr.write(c), keep(c)));
    p.on('close', (code) => done({ code: code ?? 1, tail }));
    p.on('error', (e) => done({ code: 1, tail: [String(e)] }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--setup-only')) {
    for (const dir of ['.', 'app', 'functions']) {
      if (isDepsCurrent(dir)) {
        console.log(`SKIP  npm ci (${dir}) -- up to date`);
      } else {
        console.log(`▶ npm ci (${dir})`);
        const { code } = await runStep('npm ci --no-audit --no-fund', dir);
        if (code !== 0) process.exit(code);
      }
    }
    process.exit(0);
  }

  const only = args.find((a) => a.startsWith('--job='))?.slice(6).split(',');
  const noInstall = args.includes('--no-install');
  const forceInstall = args.includes('--install');
  const noEvidence = args.includes('--no-evidence') || Boolean(only);
  const writeEvidence = args.includes('--write-evidence') || !noEvidence;

  const jobs = loadSteps().filter((j) => !only || only.includes(j.job));
  if (only && jobs.length !== only.length) {
    console.error(`Unknown job in --job=${only}. Jobs: ${loadSteps().map((j) => j.job).join(', ')}`);
    process.exit(2);
  }

  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
    ? ' + working tree'
    : '';
  const lines = [`Local run of ${WORKFLOW} at ${head}${dirty}, ${new Date().toISOString()}, node ${process.version}`];
  for (const j of jobs) {
    const want = j.setup.find((s) => s.uses === 'actions/setup-node')?.with['node-version'];
    if (want && !process.version.startsWith(`v${want}.`)) lines.push(`note: ${j.job} runs on node ${want} in CI`);
  }

  let failed = 0;
  for (const j of jobs) {
    lines.push('', `## ${j.job}`);
    for (const s of j.steps) {
      const isNpmCi = /^npm ci\b/.test(s.run.trim());
      if (isNpmCi && (noInstall || (!forceInstall && isDepsCurrent(s.cwd)))) {
        const reason = noInstall ? '--no-install' : 'up-to-date';
        lines.push(`SKIP  ${s.name} (${s.cwd}) ${reason}`);
        continue;
      }
      console.log(`\n▶ ${j.job} › ${s.name}  (${s.cwd})`);
      const t0 = Date.now();
      const { code, tail } = await runStep(s.run, s.cwd);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      lines.push(`${code === 0 ? 'PASS' : 'FAIL'}  ${s.name} (${s.cwd}) exit=${code} ${secs}s`);
      if (code !== 0) {
        failed++;
        lines.push(...tail.slice(-12).map((l) => `      ${l}`));
      }
    }
  }
  lines.push('', failed ? `${failed} step(s) failed` : 'all steps passed');
  if (writeEvidence) {
    const out = join(root, 'docs/evidence/ci-local.txt');
    writeFileSync(out, `${lines.join('\n')}\n`);
    console.log(`\n${lines.join('\n')}\n\nSummary written to docs/evidence/ci-local.txt`);
  } else {
    console.log(`\n${lines.join('\n')}\n\n(Skipped writing docs/evidence/ci-local.txt on partial/--no-evidence run)`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
