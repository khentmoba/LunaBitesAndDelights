// `npm run ci` must keep finding every required job and step in pr-checks.yml,
// and checkPrProof must enforce UI/backend proof and reject AI attribution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ciSummary, isDepsCurrent, loadSteps, unresolvedEnv } from '../../tool/ci-local.mjs';
import { checkPrProof, collectLocalChangedFiles } from '../../tool/check_pr_proof.mjs';
import { allocateFreePorts, buildEphemeralFirebaseConfig, findJava21, injectConfigArg } from '../../tool/with-java21.mjs';

test('ci-local reads every pr-checks job with its working directory', () => {
  const jobs = Object.fromEntries(loadSteps().map((j) => [j.job, j.steps.map((s) => `${s.cwd}: ${s.run.trim()}`)]));
  assert.deepEqual(Object.keys(jobs).sort(), ['functions', 'rules', 'site']);
  for (const step of ['functions: npm run build', 'functions: npm run lint', 'functions: npm test']) assert.ok(jobs.functions.includes(step), step);
  for (const step of ['functions: npm run test:rules', 'functions: npm run test:derived']) assert.ok(jobs.rules.includes(step), step);
  const functionsScripts = JSON.parse(fs.readFileSync(new URL('../../functions/package.json', import.meta.url), 'utf8')).scripts;
  assert.match(functionsScripts['test:rules'], /npm exec --prefix \.\. --no -- firebase-tools/);
  assert.match(functionsScripts['test:derived'], /npm exec --prefix \.\. --no -- firebase-tools/);
  assert.match(functionsScripts['test:rules'], /--ephemeral-emulators/);
  assert.match(functionsScripts['test:derived'], /--ephemeral-emulators/);
  for (const step of ['.: npm ci', 'app: npm run check', 'app: npm run lint', 'app: npm run build', '.: npm run test:site']) assert.ok(jobs.site.includes(step), step);
});

test('ci-local keeps step env and flags steps that need PR context', () => {
  const proof = loadSteps().flatMap((j) => j.steps)
    .find((s) => s.name === 'Verify PR proof and attribution');
  assert.ok(proof, 'proof step must be present');
  assert.equal(typeof proof.env.PR_BODY, 'string');
  assert.deepEqual(unresolvedEnv(proof.env).sort(), ['BASE_SHA', 'HEAD_SHA', 'PR_BODY']);
  assert.deepEqual(unresolvedEnv({ FOO: 'bar' }), []);
});

test('isDepsCurrent detects installed lockfiles and rejects nonexistent directories', () => {
  assert.equal(isDepsCurrent('.'), true);
  assert.equal(isDepsCurrent('nonexistent-dir'), false);
});

test('ci-local evidence reports skipped steps instead of claiming everything passed', () => {
  assert.equal(ciSummary({ failed: 0, skipped: 0, total: 3 }), 'all steps passed');
  assert.equal(ciSummary({ failed: 0, skipped: 1, total: 3 }), 'all 2 executed step(s) passed; 1 skipped');
  assert.equal(ciSummary({ failed: 1, skipped: 1, total: 3 }), '1 step(s) failed');
});

test('checkPrProof requires evidence for config, tooling and workflow changes', () => {
  for (const file of [
    'firebase.json',
    'firestore.indexes.json',
    'tool/ci-local.mjs',
    '.github/workflows/pr-checks.yml',
    'app/astro.config.mjs',
    'functions/package.json',
    'functions/package-lock.json',
    'package.json',
    'package-lock.json',
    'app/package-lock.json',
  ]) {
    assert.equal(checkPrProof({ body: 'no proof here', files: [file] }).ok, false, file);
    assert.equal(checkPrProof({ body: 'see docs/evidence/agent-environment.md', files: [file] }).ok, true, file);
  }
});

test('checkPrProof validates UI images, backend evidence paths, and forbids AI attribution', () => {
  assert.equal(
    checkPrProof({
      body: 'Updated UI ![shot](https://example.com/a.png) see docs/evidence/agent-environment.md',
      files: ['app/src/pages/kiosk/cart.astro'],
    }).ok,
    true,
  );
  assert.equal(
    checkPrProof({ body: 'Updated UI see docs/evidence/agent-environment.md', files: ['app/src/pages/kiosk/cart.astro'] }).ok,
    false,
  );
  assert.equal(
    checkPrProof({ body: 'Updated styles see docs/evidence/agent-environment.md', files: ['app/src/kiosk/tokens.css'] }).ok,
    false,
  );
  const pureLogicWithEvidence = checkPrProof({
    body: 'Updated cart logic see docs/evidence/agent-environment.md',
    files: ['app/src/kiosk/cart.ts', 'app/src/data/menu.ts'],
  });
  assert.equal(pureLogicWithEvidence.ok, true);
  assert.equal(pureLogicWithEvidence.isUI, false);
  assert.equal(
    checkPrProof({ body: 'Updated cart logic without evidence', files: ['app/src/kiosk/cart.ts'] }).ok,
    false,
  );
  assert.equal(
    checkPrProof({ body: 'Updated backend see docs/evidence/agent-environment.md', files: ['functions/src/index.ts'] }).ok,
    true,
  );
  assert.equal(
    checkPrProof({
      body: 'Docs update\n\nCo-authored-by: Bot <bot@example.com>',
      files: ['README.md'],
    }).ok,
    false,
  );
});

test('with-java21 ephemeral emulator helpers allocate distinct ports and inject --config', async () => {
  const ports = await allocateFreePorts(['auth', 'firestore', 'functions', 'hub', 'logging']);
  const values = Object.values(ports);
  assert.equal(new Set(values).size, 5, 'all 5 ports must be distinct');
  for (const port of values) assert.ok(Number.isInteger(port) && port > 0);

  const base = { firestore: { rules: 'firestore.rules' }, emulators: { singleProjectMode: true } };
  const config = buildEphemeralFirebaseConfig(base, ports);
  assert.equal(config.firestore.rules, 'firestore.rules');
  assert.equal(config.emulators.singleProjectMode, true);
  assert.equal(config.emulators.firestore.port, ports.firestore);
  assert.equal(config.emulators.functions.port, ports.functions);
  assert.equal(config.emulators.ui.enabled, false);

  const injected = injectConfigArg(
    ['npm', 'exec', '--', 'firebase-tools', 'emulators:exec', '--only', 'firestore'],
    '/tmp/fb.json',
  );
  assert.deepEqual(injected, [
    'npm',
    'exec',
    '--',
    'firebase-tools',
    'emulators:exec',
    '--config',
    '/tmp/fb.json',
    '--only',
    'firestore',
  ]);
  assert.deepEqual(
    injectConfigArg(['firebase-tools', 'emulators:exec', '--config', 'custom.json'], '/tmp/fb.json'),
    ['firebase-tools', 'emulators:exec', '--config', 'custom.json'],
  );
});

test('collectLocalChangedFiles returns an array of repo-relative paths', () => {
  const files = collectLocalChangedFiles({ base: 'HEAD' });
  assert.ok(Array.isArray(files));
});

test('with-java21 cleans up its ephemeral Firebase config on normal exit', { skip: !findJava21().found && 'Java 21 not available' }, () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const before = new Set(fs.readdirSync(repoRoot).filter((name) => name.startsWith('.firebase-ephemeral-')));
  const res = spawnSync(
    process.execPath,
    ['tool/with-java21.mjs', '--ephemeral-emulators', process.execPath, '-e', 'process.exit(0)'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const leaked = fs
    .readdirSync(repoRoot)
    .filter((name) => name.startsWith('.firebase-ephemeral-') && !before.has(name));
  assert.deepEqual(leaked, []);
});
