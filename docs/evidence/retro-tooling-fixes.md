# Retrospective Tooling & Steering Fixes Evidence

## Summary of Changes

- Stopped tracking mutable `docs/evidence/ci-local.txt`; `tool/ci-local.mjs` now writes `.ci-local.txt` (gitignored) and defaults to quiet-on-pass output (`--verbose` restores full streaming).
- Added `--ephemeral-emulators` to `tool/with-java21.mjs` and wired it into `functions/package.json` (`test:rules`, `test:derived`) to allocate free localhost ports for `auth`, `firestore`, `functions`, `hub`, and `logging` so concurrent worktrees never collide on port 8080/5001/4400.
- Enhanced `tool/check_pr_proof.mjs` with `--body-file <path>`, automatic local changed-file collection (`origin/main...HEAD` + working tree + untracked files) when `CHANGED_FILES` is unset, and a pure-logic exemption for non-UI `app/src/*.ts` files (requiring `docs/evidence/` without forcing screenshots unless pages/layouts/components/templates/styles/assets changed).
- Updated `tool/screenshot.mjs` to use an ephemeral Chrome DevTools port, clean up its temporary profile directory, and support `--serve <dir>` on an ephemeral localhost port.
- Documented `PUBLIC_FIREBASE_EMULATORS=1`, `tool/screenshot.mjs --serve`, `.ci-local.txt`, and pre-existing `rules-drift` behavior in `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/DEPLOYMENT_STATE.md`.

## Verification

- **Full local CI (`npm run ci`):** `all 14 executed step(s) passed; 4 skipped (details in .ci-local.txt)` (total stdout ~240 tokens in quiet-on-pass mode; `.ci-local.txt` stays untracked/gitignored).
  - `functions`: TypeScript build, ESLint, unit tests, outdated check, runtime audit.
  - `rules`: `test:rules` (9s) and `test:derived` (19s) with `--ephemeral-emulators`.
  - `site`: Astro check, ESLint, build, runtime audit, storefront tests (including `test/site/ci-local.test.mjs` and `test/site/file-refs.test.mjs`).
- **Concurrent emulator collision proof:** Ran two `npm --prefix functions run test:rules` processes simultaneously (`run1`, `run2`); both exited `0` in ~10s with zero port collisions and zero leftover `.firebase-ephemeral-*.json` files.
- **Screenshot `--serve` proof:** `node tool/screenshot.mjs --serve build/app / 390 844 <tmp>.png 1500` produced a valid `124,627`-byte `390x844` PNG and exited cleanly.
