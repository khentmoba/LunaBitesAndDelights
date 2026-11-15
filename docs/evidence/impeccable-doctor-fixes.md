# Impeccable doctor maintenance fixes

Branch: `chore/impeccable-doctor-fixes`
Base: `83bb49415a222b80113e4f77c9772cbf00fbbc47`

## Summary

Running `impeccable doctor --json` reported two `mention` findings:

1. `design-sidecar-stale` on `.impeccable/design.json`: `DESIGN.md` had a newer file modification timestamp than `.impeccable/design.json` (`generatedAt: "2026-10-29T22:40:00Z"`).
2. `config-build-path-unset` on `.impeccable/config.json`: the file was missing, leaving `buildPath` unrecorded.

Changes applied:

| File | Before | After |
| --- | --- | --- |
| `.impeccable/config.json` | Missing | Created with `{"buildPath": "code"}` |
| `.impeccable/design.json` | `"generatedAt": "2026-10-29T22:40:00Z"` | Refreshed `"generatedAt": "2026-11-15T05:47:00Z"` with `DESIGN.md` untouched |

Why `"code"` for `buildPath`: `PRODUCT.md` specifies code-first delivery for both surfaces (hand-written HTML/CSS/JS in `site/` and Flutter in `lib/`) backed by owner-supplied photos and logo assets rather than generated image comps. All 20 `colorMeta` keys, 10 `typographyMeta` keys, `shadows`, `motion`, `breakpoints`, 7 `components`, and `narrative` fields in `.impeccable/design.json` were verified against `DESIGN.md` with zero drift.

## Doctor before and after

Before:

```json
{
  "projectRoot": "C:\\Users\\Admin\\.t3\\worktrees\\LunaBites and Delights\\t3-45ea8c3f-7cbeaa387605e4ce",
  "repoRoot": "C:\\Users\\Admin\\.t3\\worktrees\\LunaBites and Delights\\t3-45ea8c3f-7cbeaa387605e4ce",
  "isMonorepo": false,
  "productPath": "PRODUCT.md",
  "designPath": "DESIGN.md",
  "platform": "adaptive",
  "ruleRegistryAvailable": true,
  "findings": [
    {
      "id": "design-sidecar-stale",
      "artifact": "design.json",
      "path": ".impeccable/design.json",
      "severity": "mention"
    },
    {
      "id": "config-build-path-unset",
      "artifact": "config.json",
      "path": ".impeccable/config.json",
      "severity": "mention"
    }
  ],
  "workspaces": []
}
```

After:

```json
{
  "projectRoot": "C:\\Users\\Admin\\.t3\\worktrees\\LunaBites and Delights\\t3-45ea8c3f-7cbeaa387605e4ce",
  "repoRoot": "C:\\Users\\Admin\\.t3\\worktrees\\LunaBites and Delights\\t3-45ea8c3f-7cbeaa387605e4ce",
  "isMonorepo": false,
  "productPath": "PRODUCT.md",
  "designPath": "DESIGN.md",
  "platform": "adaptive",
  "ruleRegistryAvailable": true,
  "findings": [],
  "workspaces": []
}
```

## Local checks

Every job in `.github/workflows/pr-checks.yml` ran locally on this branch:

| Job | Command | Result |
| --- | --- | --- |
| Impeccable doctor | `impeccable.cmd doctor --json` | `findings: []` (0 findings) |
| JSON parse check | `node -e "JSON.parse(...)"` on both `.impeccable/*.json` | Valid JSON |
| Flutter analyze | `flutter analyze --no-fatal-infos --no-fatal-warnings` + `node tool/check_analyzer_baseline.mjs` | 0 issues, baseline 0 |
| Flutter format | `dart format --output=none --set-exit-if-changed` | No Dart files changed |
| Flutter tests | `flutter test` | 84 passed, 0 failed |
| Flutter web build | `flutter build web --release --wasm` | Built `build/web` (62.0s) |
| Functions build | `cd functions && npm run build` | Compiled TypeScript (`tsc`) |
| Functions audit | `cd functions && npm audit --audit-level=high` | 0 high or critical vulnerabilities |
| Functions tests | `cd functions && npm test` | 28 passed, 0 failed |
| Firestore rules | `cd functions && npm run test:rules` (JDK 21) | 23 passed across 6 suites, 0 failed |
| Site tests | `npm run test:site` | 25 passed, 0 failed |
| Rules drift check | `cd functions && npm run check:rules-drift` | Could not compare rules (no Google default credentials on this machine); `firestore.rules` was not modified or deployed |

No screenshots were captured because no rendered UI files (`site/`, `lib/`, `web/`) were modified.
