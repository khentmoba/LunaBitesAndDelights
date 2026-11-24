# Reliability, Security, and Bug-Fix Validation

## Changes Verified

1. **Daily sales report in-flight lease retry (`functions/src/reporting/daily_report.ts`)**
   - Added `evaluateDailyReportClaim()` returning `'claimed' | 'already-sent' | 'in-flight' | 'failed-permanent'`.
   - `runDailySalesReport()` now returns `{ sent: false, skipped: true, inFlight: true }` when an active `sending` lease is observed, and `dailySalesReport` throws when `res.inFlight` is true so Cloud Scheduler retries until the lease settles or expires instead of silently dropping retries.
   - Verified by `functions/test/hardening_baseline.test.js` (`runDailySalesReport tracks partial deliveries...`).

2. **Public `verifyStaff` password length ceiling (`functions/src/auth/verify_staff.ts`)**
   - Added `MAX_PASSWORD_LENGTH = 200` and `isValidPasswordInput()` to reject oversized password payloads before Firestore reads or `scrypt` hashing, preventing CPU/memory DoS on the public callable.
   - Verified by `functions/test/staff_auth.test.js` (`isValidPasswordInput caps password length to prevent scrypt DoS`).

3. **Secret Manager trailing-newline resilience (`functions/src/payments/paymongo.ts`, `functions/src/payments/webhook.ts`, `functions/src/orders/send_notification.ts`)**
   - Trimmed `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`, and `MAPTILER_KEY` at read time, and URL-encoded `apiKey` in `getMapTilerStaticMapUrl()`.
   - Verified by `functions/test/payment_reconciliation.test.js` (`paymongoAuthHeader trims secret whitespace...`, `getMapTilerStaticMapUrl trims and URL-encodes the API key`).

4. **Bounded IndexedDB settlement in `hasStoredStaffUser()` (`app/src/kiosk/staff-hint.ts`)**
   - Handled `open.onblocked`, `tx.onabort`, `tx.onerror`, and single-settlement cleanup so customer pages cannot hang waiting on a blocked or aborted IndexedDB handle.
   - Verified by `test/site/kiosk.test.mjs` (`hasStoredStaffUser settles cleanly on blocked or aborted IndexedDB and detects staff users`).

5. **Map geolocation race & Google Maps callback cleanup (`app/src/pages/kiosk/map.astro`)**
   - Guarded `goToMyLocation()` with `locateSeq` and `locating` state so overlapping taps are prevented, `[data-locate]` disables while locating, and stale GPS callbacks cannot overwrite a manual pan, search pick, or confirm.
   - Cleaned up temporary `window.__lunaMaps_*` callback on load and error.
   - Verified in headless browser at 390x844 (mobile) and 1440x900 (desktop).

## Full Local CI

All 14 executed steps of `.github/workflows/pr-checks.yml` (`functions`, `rules` emulator suite, `site` Astro build + typecheck + lint + 84 site tests) passed; see `docs/evidence/ci-local.txt`.
