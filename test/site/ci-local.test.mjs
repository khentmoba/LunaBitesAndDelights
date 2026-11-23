// `npm run ci` must keep finding every required job and step in pr-checks.yml,
// and checkPrProof must enforce UI/backend proof and reject AI attribution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDepsCurrent, loadSteps } from '../../tool/ci-local.mjs';
import { checkPrProof } from '../../tool/check_pr_proof.mjs';

test('ci-local reads every pr-checks job with its working directory', () => {
  const jobs = Object.fromEntries(loadSteps().map((j) => [j.job, j.steps.map((s) => `${s.cwd}: ${s.run.trim()}`)]));
  assert.deepEqual(Object.keys(jobs).sort(), ['functions', 'rules', 'site']);
  for (const step of ['functions: npm run build', 'functions: npm run lint', 'functions: npm test']) assert.ok(jobs.functions.includes(step), step);
  for (const step of ['functions: npm run test:rules', 'functions: npm run test:derived']) assert.ok(jobs.rules.includes(step), step);
  for (const step of ['.: npm ci', 'app: npm run check', 'app: npm run lint', 'app: npm run build', '.: npm run test:site']) assert.ok(jobs.site.includes(step), step);
});

test('isDepsCurrent detects installed lockfiles and rejects nonexistent directories', () => {
  assert.equal(isDepsCurrent('.'), true);
  assert.equal(isDepsCurrent('nonexistent-dir'), false);
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
