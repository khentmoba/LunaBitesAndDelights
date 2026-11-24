# Input Validation, KDS, Service Worker, and Login Hardening — Validation Evidence

## Changes Verified

1. **Strict input validation in `optStr` and `cleanInt` (`functions/src/util/security.ts`)**
   - `optStr` now throws `HttpsError('invalid-argument')` when passed non-string non-nullish values (objects, arrays, numbers, booleans) instead of coercing them with `String(...)` (which previously turned `{}` into `"[object Object]"`).
   - `cleanInt` now accepts only finite integer numbers or trimmed non-negative integer digit strings (`/^\d+$/`), rejecting booleans, arrays, `null`, `undefined`, whitespace/empty strings, floats, and scientific notation that `Number(...)` previously coerced (e.g. `""`, `null`, `false`, `[]` → `0`; `true`, `["5"]` → `1`/`5`).
   - Verified via `functions/test/hardening_baseline.test.js` (`optStr and cleanInt reject non-string and coerced non-integer inputs`).

2. **KDS summary item-count fallback for `null` / `""` (`functions/src/orders/kds.ts`)**
   - Extracted `validStoredItemsCount(raw)` so `projectOrderSummary` and `getLegacyItemCounts` only treat finite non-negative numbers (`typeof raw === 'number'`) as stored counts.
   - Previously, `Number(null)` and `Number('')` evaluated to `0`, hiding legacy orders with `itemsCount: null` or `''` from the recount fallback and showing `0` items on the dashboard.
   - Verified via `functions/test/hardening_baseline.test.js` (`KDS summary item count falls back when itemsCount is null or empty string`).

3. **Staff service worker partial-response caching guard (`app/public/staff/sw.js`)**
   - Tightened all three `Cache.put` guards from `res.ok` to `res.status === 200` so `206 Partial Content` responses (which have `res.ok === true` but cause `Cache.put()` to reject) are not cached.
   - Verified via `test/site/staff.test.mjs` (`staff service worker serves immutable assets cache-first and prunes navigation cache entries`, including explicit `206 Partial Content` non-caching check).

4. **Staff login async disposal and touch `pointercancel` cleanup (`app/src/staff/login.ts`)**
   - Added a `disposed` guard across `verify()` and the long-press timer so a late `verifyStaff` resolution after teardown cannot trigger `signInWithToken`, show a welcome snack, or re-render.
   - Added `pointercancel` cleanup for the backspace long-press hold timer and cleared any prior timer before arming a new one.
   - Verified via JSDOM behavior test in `test/site/staff.test.mjs` (`mountLogin cancels backspace long-press on pointercancel and ignores late verifyStaff after dispose`).

5. **Haversine `Math.asin` domain clamping (`app/src/kiosk/order.ts`)**
   - Clamped `a` to `[0, 1]` before `Math.asin(Math.sqrt(...))` so floating-point overshoot on near-antipodal coordinates (where `a = 1.0000000000000004` previously returned `NaN`) produces a finite distance.
   - Verified via `test/site/kiosk.test.mjs` (`haversine stays finite for identical and antipodal-jitter coordinates`).

## CI Verification

Full local CI run recorded in [`docs/evidence/ci-local.txt`](ci-local.txt):
- `functions`: TypeScript build, ESLint, unit tests, runtime audit — all PASS.
- `rules`: Firestore rules emulator tests + derived views emulator tests — all PASS.
- `site`: Astro type check, ESLint, production build, runtime audit, 88/88 storefront/kiosk/staff tests — all PASS.
