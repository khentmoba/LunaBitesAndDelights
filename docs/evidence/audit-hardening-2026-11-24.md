# Audit Hardening — 2026-11-24

Summary of reliability, security, and bug fixes verified in this pass.

## Fixes & Verification

1. **Atomic manual report lease & sent-state persistence retry (`functions/src/reporting/manual_report.ts`)**
   - Added `evaluateManualReportClaim` and an atomic `db.runTransaction` claim (`status: 'sending'`, 60s TTL) so concurrent staff triggers cannot send duplicate Telegram sales reports.
   - Added bounded retry backoff when persisting `status: 'sent'` so transient Firestore errors do not leave stale `sending`/`failed` guard state.
   - Verified by `functions/test/hardening_baseline.test.js` (`runManualSalesReport blocks concurrent in-flight sends and retries sent-state persistence`).

2. **Malformed items & non-finite numeric guards in reporting (`functions/src/util.ts`, `functions/src/reporting/daily_stats.ts`, `functions/src/reporting/aggregator.ts`, `functions/src/reporting/analytics.ts`)**
   - Added `finiteNumber()` and `Array.isArray(data.items)` guards so malformed/legacy order documents cannot throw `TypeError` in `onOrderWritten`, concatenate string amounts in fallback reports, or poison `dailyStats` with `NaN`.
   - Verified by `functions/test/daily_stats.test.js` (`contributionOf and finiteNumber tolerate malformed items and non-finite numeric fields`).

3. **Strict `idempotencyKey` validation (`functions/src/orders/place_order.ts`)**
   - Added `parseIdempotencyKey()` so non-string or malformed `idempotencyKey` inputs fail fast with `invalid-argument` instead of silently bypassing order deduplication.
   - Verified by `functions/test/hardening_baseline.test.js` (`parseIdempotencyKey rejects non-string and malformed keys while allowing absent values`).

4. **Google Maps script load timeout & degraded guard (`app/src/pages/kiosk/map.astro`)**
   - Added a 10s timeout (`MAPS_LOAD_TIMEOUT_MS`) to `loadMaps()` that cleans up the global callback, removes the stalled `<script>` element, and falls back to the tile-free notice, plus a `degraded` guard against late callback resolution after `gm_authFailure`.
   - Verified by `test/site/staff.test.mjs` and rendered screenshots (`kiosk-map-mobile.png`, `kiosk-map-desktop.png` on `evidence @ f2f6fc4`).

5. **KDS polling history toggle & listener teardown guard (`app/src/staff/kds.ts`)**
   - Opening the DONE tab or toggling `HISTORY` while in polling fallback mode now calls `fetchActive(false)` so an in-flight `includeCompleted: false` poll cannot drop the user's request for completed orders.
   - Reset `connecting = false` on early return after `await` when `disposed || authHalted`.
   - Verified by `test/site/staff.test.mjs`.

## Local CI Result

Full `npm run ci` run passed all 12 executed checks (functions build/lint/unit/audit, Firestore rules & derived-views emulator tests, Astro check/lint/build/audit, and 89 storefront/kiosk/staff tests). See `docs/evidence/ci-local.txt`.
