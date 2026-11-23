// `npm run ci` must keep finding every required job and step in pr-checks.yml,
// and checkPrProof must enforce UI/backend proof and reject AI attribution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ciSummary, isDepsCurrent, loadSteps, unresolvedEnv } from '../../tool/ci-local.mjs';
import { checkPrProof } from '../../tool/check_pr_proof.mjs';

test('ci-local reads every pr-checks job with its working directory', () => {
  const jobs = Object.fromEntries(loadSteps().map((j) => [j.job, j.steps.map((s) => `${s.cwd}: ${s.run.trim()}`)]));
  assert.deepEqual(Object.keys(jobs).sort(), ['functions', 'rules', 'site']);
  for (const step of ['functions: npm run build', 'functions: npm run lint', 'functions: npm test']) assert.ok(jobs.functions.includes(step), step);
  for (const step of ['functions: npm run test:rules', 'functions: npm run test:derived']) assert.ok(jobs.rules.includes(step), step);
  const functionsScripts = JSON.parse(fs.readFileSync(new URL('../../functions/package.json', import.meta.url), 'utf8')).scripts;
  assert.match(functionsScripts['test:rules'], /npx --no-install firebase-tools/);
  assert.match(functionsScripts['test:derived'], /npx --no-install firebase-tools/);
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
    assert.equal(checkPrProof({ body: 'see docs/evidence/ci-local.txt', files: [file] }).ok, true, file);
  }
});

test('checkPrProof validates UI images, backend evidence paths, and forbids AI attribution', () => {
  assert.equal(
    checkPrProof({
      body: 'Updated UI ![shot](https://example.com/a.png) see docs/evidence/ci-local.txt',
      files: ['app/src/kiosk/cart.ts'],
    }).ok,
    true,
  );
  assert.equal(
    checkPrProof({ body: 'Updated UI see docs/evidence/ci-local.txt', files: ['app/src/kiosk/cart.ts'] }).ok,
    false,
  );
  assert.equal(
    checkPrProof({ body: 'Updated backend see docs/evidence/ci-local.txt', files: ['functions/src/index.ts'] }).ok,
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
