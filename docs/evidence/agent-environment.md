# Agent environment fixes (retro, 2026-11-18)

Nine fixes from the retro of the TypeScript-port threads. Each was checked on
this machine (Windows 11, Node 24, Git Bash).

## 1. Emulator tests run locally (Java 21)

`tool/with-java21.mjs` picks `C:\Users\Admin\.jdks\temurin-21\bin` over the
Java 8 that comes first on PATH. With no Java 21 it exits 1 and names the
Temurin download.

- `npm run test:rules`: 23/23 pass (the first local run since the port)
- `npm run test:derived`: 2/2 pass

## 2. One-command local CI

`npm run ci` reads `.github/workflows/pr-checks.yml` and runs every `run:`
step in its working directory. The full run passed all 16 steps; see
[ci-local.txt](ci-local.txt). `test/site/ci-local.test.mjs` asserts that the
parser finds the functions, rules and site jobs and their key steps.

## 3. Proof images off main

All 550 images (322 png, 222 webp, 6 jpg; about 206 MB) are on the orphan
`evidence` branch at their old paths, in a single root commit. On main,
docs/evidence is now 7.4 MB. 296 image links in 28 write-ups now point at
`blob/evidence/...?raw=true`, and every link resolved. For example,
`adaptive-kiosk-menu-1440.png` returns 200 `image/png`, 922,153 bytes.
Publishing a file that is already there is a no-op: no new commit. Publishing
a new file appends one commit onto the current tip (`0458ffc` has parent
`0df9d73`).

## 4. LF line endings

`.gitattributes` sets `* text=auto eol=lf` (with `*.bat` kept as CRLF) and marks
`docs/evidence/**` as linguist-generated.

## 5. Globbed test lists, derived views in CI

The functions unit tests, emulator tests (moved to `functions/test/emulator/`)
and site tests run from globs. CI now runs `test:derived`.

## 6. Promise lint

typescript-eslint `no-floating-promises` and `no-misused-promises` lint 33 app
files and 47 functions files with 0 errors. Mutation check: making `logout()`
in `app/src/kiosk/kds.ts` unawaited fails lint with exit 1. The functions
audit now uses `--omit=dev`, as the site job already did: typescript-eslint
pulls in picomatch 4.0.7, and GHSA-fc5q-39xc-vjpf has no fixed release.
picomatch is a dev dependency only and never ships.

## 7. png_diff in Node

`tool/png_diff.mjs` replaces the PIL script. On a 1440x900 screenshot with a
40x30 patch inverted, it reported `1200 px differ in 40x30 at (50,100)`. It
also wrote a 1.7 KB crop showing the old and new versions side by side:

![png_diff crop](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/agent-environment-png-diff-crop.png?raw=true)

## 8. Dangling path check

`test/site/file-refs.test.mjs` passes on the current tree. Mutation check: a
bogus `app/src/gone.ts` added to AGENTS.md fails the test with
`AGENTS.md:42 -> app/src/gone.ts`. The test also caught a placeholder path in
the publish_evidence usage text, which is now fixed.

## 9. AGENTS.md

Removed the duplicate `$file-pr` line, the "proof job removed" note and the
repeated proof bullet. The local-checks step now says `npm run ci`, and the
screenshot step now points at `publish_evidence.mjs` and `png_diff.mjs`.
