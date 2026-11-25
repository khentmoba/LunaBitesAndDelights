// Checks PR description proof requirements (AGENTS.md) and rejects AI attribution.
// Inputs (env): PR_BODY (pull request description), CHANGED_FILES (newline-separated repo paths).
// Local CLI: node tool/check_pr_proof.mjs --body-file <path> [--base origin/main]
// When CHANGED_FILES is unset, local git diff + staged + untracked files are collected automatically.
//
// UI change (lib/ except services and models, web/, app/public/, app/src/ pages/layouts/components or .astro/.css/.scss/.html/.svg): needs an inline image and a docs/evidence/ reference.
// Backend/logic change (functions/src/, lib/services/, app/src/ pure-logic files, config/tooling/workflows, rules): needs a docs/evidence/ reference.
// Attribution check: rejects Co-authored-by trailers and AI model/harness attribution in PR_BODY.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ATTRIBUTION_RE =
  /(?:Co-authored-by:|\b(?:Generated with Claude|Claude Opus|Claude Sonnet|Gemini \d|Hy4 Flash|DeepSeek-V\d|gpt-\d\.\d-codex)\b)/i;

export function checkPrProof({ body = '', files = [] } = {}) {
  const isUiFile = (file) =>
    (/^(lib|web|app\/public)\//.test(file) && !/^lib\/(services|models)\//.test(file)) ||
    /^app\/src\/(pages|layouts|components)\//.test(file) ||
    (/^app\/src\//.test(file) && /\.(astro|css|scss|html|svg)$/i.test(file));
  const isUI = files.some(isUiFile);
  // Config, tooling and workflow files can weaken security headers, TTL parity
  // or the proof gate itself, so they require backend-grade evidence too.
  const isBackend = files.some(
    (file) =>
      /^(functions\/src\/|functions\/package(?:-lock)?\.json$|lib\/services\/|firestore\.rules$|storage\.rules$|firebase\.json$|firestore\.indexes\.json$|tool\/|app\/astro\.config\.mjs$|app\/package(?:-lock)?\.json$|package(?:-lock)?\.json$|\.github\/workflows\/)/.test(
        file,
      ) ||
      (/^app\/src\//.test(file) && !isUiFile(file)),
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

export function collectLocalChangedFiles({ base = 'origin/main', cwd = process.cwd() } = {}) {
  const files = new Set();
  const runGit = (gitArgs) => {
    try {
      const out = execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) files.add(trimmed);
      }
    } catch {}
  };
  runGit(['diff', '--name-only', `${base}...HEAD`]);
  runGit(['diff', '--name-only']);
  runGit(['diff', '--cached', '--name-only']);
  runGit(['ls-files', '--others', '--exclude-standard']);
  return [...files].sort();
}

function parseCliArgs(argv) {
  let bodyFile = null;
  let base = 'origin/main';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--body-file' && argv[i + 1]) {
      bodyFile = argv[++i];
    } else if (argv[i].startsWith('--body-file=')) {
      bodyFile = argv[i].slice('--body-file='.length);
    } else if (argv[i] === '--base' && argv[i + 1]) {
      base = argv[++i];
    } else if (argv[i].startsWith('--base=')) {
      base = argv[i].slice('--base='.length);
    }
  }
  return { bodyFile, base };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bodyFile, base } = parseCliArgs(process.argv.slice(2));
  const body = bodyFile ? readFileSync(bodyFile, 'utf8') : (process.env.PR_BODY ?? '');
  const hasChangedFilesEnv = typeof process.env.CHANGED_FILES === 'string';
  const files = hasChangedFilesEnv
    ? process.env.CHANGED_FILES.split('\n')
        .map((file) => file.trim())
        .filter(Boolean)
    : collectLocalChangedFiles({ base });
  const { ok, isUI, isBackend, failures } = checkPrProof({ body, files });
  if (!ok) {
    console.error(`Proof check failed for ${files.length} changed files:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Proof OK (UI: ${isUI}, backend: ${isBackend}, ${files.length} changed files).`);
}
