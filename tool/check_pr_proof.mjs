// Checks PR description proof requirements (AGENTS.md) and rejects AI attribution.
// Inputs (env): PR_BODY (pull request description), CHANGED_FILES (newline-separated repo paths).
//
// UI change (lib/ except services and models, web/, app/src/, app/public/): needs an inline image and a docs/evidence/ reference.
// Backend change (functions/src/, lib/services/, firestore.rules, storage.rules): needs a docs/evidence/ reference.
// Attribution check: rejects Co-authored-by trailers and AI model/harness attribution in PR_BODY.
import { pathToFileURL } from 'node:url';

const ATTRIBUTION_RE =
  /(?:Co-authored-by:|\b(?:Generated with Claude|Claude Opus|Claude Sonnet|Gemini \d|Hy4 Flash|DeepSeek-V\d|gpt-\d\.\d-codex)\b)/i;

export function checkPrProof({ body = '', files = [] } = {}) {
  const isUI = files.some(
    (file) => /^(lib|web|app\/src|app\/public)\//.test(file) && !/^lib\/(services|models)\//.test(file),
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
  const attrMatch = ATTRIBUTION_RE.exec(body);
  if (attrMatch) {
    failures.push(`AI/tool attribution forbidden in PR body (matched "${attrMatch[0]}").`);
  }
  return { ok: failures.length === 0, isUI, isBackend, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const body = process.env.PR_BODY ?? '';
  const files = (process.env.CHANGED_FILES ?? '')
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  const { ok, isUI, isBackend, failures } = checkPrProof({ body, files });
  if (!ok) {
    console.error(`Proof check failed for ${files.length} changed files:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Proof OK (UI: ${isUI}, backend: ${isBackend}, ${files.length} changed files).`);
}
