# Performance, Reliability & Security Hardening Proof

## Summary of Fixes

1. **Payment confirmation Telegram idempotency (`functions/src/orders/send_notification.ts`)**
   - `evaluatePaymentNotificationClaim` now recognizes `paymentNotifStatus === 'failed_permanent'`.
   - `notifyPaymentConfirmedOnce` tracks `paymentDeliveredChatIds` across partial multi-chat failures and passes `skipChatIds` on retry.
   - Separated `sendToAll` from Firestore `paymentNotifSent: true` persistence (with retry backoff) so transient Firestore write errors after Telegram delivery never flip status back to `'failed'` and trigger duplicate alerts.
2. **Daily sales report Telegram idempotency (`functions/src/reporting/daily_report.ts`)**
   - `canClaimDailyReport` now returns `false` on `status === 'failed_permanent'`.
   - Extracted `runDailySalesReport`, which persists `deliveredChatIds` across partial failures, skips permanent Telegram errors without retrying, and separates `sendToAll` from Firestore `status: 'sent'` persistence with retry backoff.
3. **PayMongo checkout response validation (`functions/src/payments/create_checkout.ts`)**
   - Safely handles non-JSON HTTP error bodies (e.g. 502/503 HTML gateway pages) instead of throwing `SyntaxError`.
   - Added `parsePaymongoCheckoutResponse` to validate `checkout.id` format and ensure `checkout_url` is an `https:` URL on an allowed PayMongo-family host (`paymongo.com`, `gcash.com`, `paymaya.com`, `maya.ph`) before writing to Firestore.
4. **Bounded cache TTL & Firestore read projection (`functions/src/reporting/daily_stats.ts`, `functions/src/orders/kds.ts`)**
   - Added `BACKFILL_CACHE_TTL_MS` (5 minutes) to `isDailyStatsBackfilled` so warm Cloud Functions instances still skip redundant reads while observing maintenance resets within a bounded TTL (still never caching `false`).
   - Added `.select(...SUMMARY_ORDER_FIELDS)` to `getActiveOrders` when `summaryOnly === true` so dashboard queries skip downloading unused PII and checkout fields from Firestore.
5. **Unpaid-order expiry sweep error isolation (`functions/src/orders/expire_unpaid.ts`)**
   - Extracted `expireStaleUnpaidBatch` and wrapped each per-order expiration transaction in `try/catch` so a single contended document cannot abort the daily sweep.
6. **Lifetime report date validation (`functions/src/reporting/lifetime_report.ts`)**
   - Added `isValidCalendarDate` and `resolveReportDateRange` to reject impossible calendar dates (e.g. `2026-02-31`) and inverted ranges (`startDate > endDate`) with `HttpsError('invalid-argument', ...)`.
7. **KDS auth-error listener/timer cleanup (`app/src/staff/kds.ts`)**
   - `updateStatus` now calls `haltOnAuthError(...)` on `unauthenticated` / `permission-denied` errors, tearing down the `onSnapshot` listener and background polling/reconnect/lookback timers.

## Verification

- **Backend unit tests (`functions/test/hardening_baseline.test.js`, `functions/test/daily_stats.test.js`):** Added focused tests covering `notifyPaymentConfirmedOnce`, `runDailySalesReport`, `parsePaymongoCheckoutResponse`, `isDailyStatsBackfilled` TTL expiry, `expireStaleUnpaidBatch` contention isolation, and `isValidCalendarDate` / `resolveReportDateRange`.
- **Frontend & site tests (`test/site/staff.test.mjs`):** Added regression check verifying `updateStatus` invokes `haltOnAuthError` on auth failures.
- **Full local CI:** Recorded in `docs/evidence/ci-local.txt` (`functions`, `rules` emulator suite, and `site` checks all pass).
- **Rendered KDS verification (headless Chrome):**
  - Desktop (1440x900): `https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/staff-kds-desktop.png?raw=true`
  - Mobile (390x844): `https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/staff-kds-mobile.png?raw=true`
