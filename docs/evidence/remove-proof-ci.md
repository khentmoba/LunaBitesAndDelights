# Remove the proof CI job

Branch: `t3/remove-proof-ci`
Base: `b75273f9db77b1b7300fc403a2955b5d90b09f91`

## Summary

The owner asked to remove the proof CI job. The `proof` job in `.github/workflows/pr-checks.yml` ran `tool/check_pr_proof.mjs` on every PR and was a required status check on `main`.

Changes:

| Surface | Before | After |
| --- | --- | --- |
| `.github/workflows/pr-checks.yml` | `proof` job plus a comment listing it in the required checks | Job removed; comment lists `flutter / functions / rules`; the format step reads `github.base_ref` from an env var; action tags are pinned to commit SHAs |
| `AGENTS.md` | Said CI enforced proof and branch protection required it | Says evidence is checked in review; branch protection requires `flutter`, `functions`, `rules` |
| `tool/check_pr_proof.mjs` | Header said it fails PRs | Header says it is an optional local check |
| `main` branch protection | `strict: true`, contexts `flutter`, `functions`, `rules`, `proof` | `strict: true`, contexts `flutter`, `functions`, `rules` |

The `site` job still runs on PRs. It is not in branch protection, so it was not added as a new required check. `tool/check_pr_proof.mjs` stays in the repo for local use, but CI no longer runs it.

The evidence requirements in `AGENTS.md` stay. Reviewers still check `docs/evidence/` artifacts and inline images in PRs.

## Branch protection proof

The branch protection change is a GitHub setting, not a file in the PR. It was applied with:

```bash
gh api --method PATCH \
  repos/khentmoba/LunaBitesAndDelights/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict":true,"contexts":["flutter","functions","rules"]}
JSON
```

Before: `branch-protection-before.json`

```json
{"strict":true,"contexts":["flutter","functions","rules","proof"]}
```

After, read back from GitHub: `branch-protection-after.json`

```json
{"contexts":["flutter","functions","rules"],"strict":true}
```

## Workflow proof

`local-checks/workflow-validation.txt` parses the YAML and asserts the job list:

```json
{
  "jobs": [
    "flutter",
    "functions",
    "rules",
    "site"
  ],
  "proof_present": false
}
```

`local-checks/workflow-proof-grep.txt` is empty: no `proof` string remains in `.github/workflows/pr-checks.yml`. The format step now reads `github.base_ref` through the `BASE_REF` env var, and `local-checks/action-pins.txt` records the commit SHAs used to pin every action. Both changes clear the static-analysis blockers in this file. Remaining `zizmor` warnings about credential persistence and broad permissions are pre-existing and out of scope.

## Local checks

Every job that remains in `pr-checks.yml` was run locally. Raw output is in `local-checks/`.

| Job | Command | Result |
| --- | --- | --- |
| flutter analyze | `flutter analyze --no-fatal-infos --no-fatal-warnings` + `node tool/check_analyzer_baseline.mjs` | 0 issues, baseline 0 — PASS |
| flutter format | `dart format --output=none --set-exit-if-changed` | no Dart files changed — PASS |
| flutter tests | `flutter test` | 44 passed, 0 failed — PASS |
| flutter web build | `flutter build web --release --base-href /kiosk/` | Built `build/web` — PASS |
| functions install | `cd functions && npm ci` | PASS |
| functions build | `cd functions && npm run build` | TypeScript compiled — PASS |
| functions audit | `cd functions && npm audit --audit-level=high` | 0 high or critical — PASS |
| functions tests | `cd functions && npm test` | 16 passed, 0 failed — PASS |
| rules emulator | `cd functions && npm run test:rules` with JDK 21 | 8 passed, 0 failed — PASS |
| site install | `npm ci` | PASS |
| site tests | `npm run test:site` | 9 passed, 0 failed — PASS |

`npm run check:rules-drift` is a read-only check from `AGENTS.md`, not a CI job. It could not run because this machine has no Google default credentials; the exact error is in `local-checks/rules-drift.txt`. No rules were deployed or changed.

The optional local proof helper still passes on this change:

```text
CHANGED_FILES="$(git diff --name-only "$BASE_SHA...$HEAD_SHA")"
PR_BODY="... docs/evidence/remove-proof-ci.md ..."
node tool/check_pr_proof.mjs
# Proof OK (UI: false, backend: false, <n> changed files).
```

No screenshots: this change does not touch a rendered surface.

## Review

No-comments pass: the diff has no redundant narration or commented-out code. The two changed comments describe the new state of the workflow and the local helper.

DeepSeek loop: one round, performed locally because `AGENTS.md` forbids delegation unless the user explicitly asks. Reviewer read the diff against `b75273f`, the workflow, `AGENTS.md`, the tool header, the branch-protection output, and the workflow-validation output. Verdict: `SHIP`. No findings, so triage was skipped. No step back, no fixed/declined/ignored ids. The action pinning and env-var change happened before the verdict, so the behavior diff did not change after it. No model usage was exposed.

## Merge danger

Low / two-way door. The PR removes one CI job and its required status check. Re-adding the job and the branch-protection context restores the old gate. Evidence artifacts remain required by `AGENTS.md` and are checked in review.
