// Optional local check for the proof AGENTS.md requires. Not run in CI.
// Inputs (env): PR_BODY (pull request description), CHANGED_FILES (newline-separated repo paths).
//
// UI change (lib/ except services and models, web/, site/): needs an inline image and a docs/evidence/ reference.
// Backend change (functions/src/, lib/services/, firestore.rules, storage.rules): needs a docs/evidence/ reference.

const body = process.env.PR_BODY ?? '';
const files = (process.env.CHANGED_FILES ?? '')
  .split('\n')
  .map((file) => file.trim())
  .filter(Boolean);

const isUI = files.some(
  (file) => /^(lib|web|site)\//.test(file) && !/^lib\/(services|models)\//.test(file),
);
const isBackend = files.some((file) =>
  /^(functions\/src\/|lib\/services\/|firestore\.rules$|storage\.rules$)/.test(file),
);
const hasImage = /!\[[^\]]*\]\([^)]+\)/.test(body);
const hasEvidence = /docs\/evidence\//.test(body);

const failures = [];
if (isUI && !hasImage) failures.push('UI change: embed a screenshot in the PR body as ![alt](url).');
if ((isUI || isBackend) && !hasEvidence) {
  failures.push('Product change: reference the proof file under docs/evidence/ in the PR body.');
}

if (failures.length > 0) {
  console.error(`Proof missing for ${files.length} changed files:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Proof OK (UI: ${isUI}, backend: ${isBackend}, ${files.length} changed files).`);
