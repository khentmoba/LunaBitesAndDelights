# Site Bug Audit — Local Verification Evidence

## Checks Run

- `cd app && npm run check` — **PASS** (`Result (53 files): 0 errors, 0 warnings, 0 hints`)
- `cd app && npm run build` — **PASS** (`17 page(s) built`)
- `npm run test:site` — **PASS** (`52/52` tests passing, including favicon assertion on `/404.html`, `/payment/success/`, `/payment/cancel/`)
- `cd functions && npm run build` — **PASS** (`0` TypeScript errors after adding `"rootDir": "src"` to `functions/tsconfig.json`)
- `cd functions && npm run lint` — **PASS** (`eslint` exited 0)
- `cd functions && npm test` — **PASS** (`31/31` tests passing)
- Headless Chrome verification (`390x844` mobile): `/404.html`, `/payment/success/`, `/payment/cancel/` returned `[]` for 4xx/5xx network responses (no `/favicon.ico` 404). Screenshot: `docs/evidence/site-bug-audit-404.png`.
- `cd functions && npm run test:rules` — **Not run locally** (local JDK is `< 21`; verified in GitHub Actions `rules` job with Temurin JDK 21).
- `cd functions && npm run check:rules-drift` — **Not run locally** (no GCP credentials in local environment; `firestore.rules` was intentionally left untouched so it stays in sync with production).
