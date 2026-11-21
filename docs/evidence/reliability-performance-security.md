# Reliability, Performance, and Security Improvements

Verified via `npm run ci` (summary in `docs/evidence/ci-local.txt`).

## Security

- **No plaintext credential logging on staff seed**: `functions/src/auth/verify_staff.ts` no longer logs generated initial passwords or PINs to Cloud Logging when seeding `staff_accounts`. Added `functions/scripts/reset-staff-credentials.js` to bootstrap or rotate staff passwords and PINs out-of-band using `hashPasswordAsync`. Covered in `functions/test/staff_auth.test.js`.
- **Pinned `firebase-tools` in deploy workflow**: `.github/workflows/firebase-hosting-merge.yml` installs root dependencies via `npm ci` and runs `npx --no-install firebase-tools` instead of pulling an unpinned `firebase-tools` release at deploy time.
- **Bounded Cloud Functions scaling**: `functions/src/index.ts` sets `setGlobalOptions({ maxInstances: 10 })` before loading function exports to cap blast radius and runaway billing under traffic spikes or retry storms.

## Reliability

- **Stale Telegram claim recovery & retryable in-flight handling**: `functions/src/orders/send_notification.ts` records `telegramClaimedAt` with a 60s `TELEGRAM_CLAIM_TTL_MS` lease and exposes `evaluateNotificationClaim` to distinguish `'in-flight'` from `'already-sent'`. `functions/src/orders/derived.ts` throws when `onOrderWritten` observes an in-flight lease so `retry: true` retries until the notification settles or the lease expires after a crash. Covered in `functions/test/telegram_notification.test.js`.
- **PAID TOCTOU guard on checkout creation**: `functions/src/payments/create_checkout.ts` re-checks `paymentStatus === 'PAID'` inside a Firestore transaction before binding `checkoutSessionId` to an order, preventing a concurrent payment completion from being overwritten.
- **Dashboard refresh race guard**: `app/src/staff/dashboard.ts` tracks a monotonic `fetchSeq` counter so out-of-order refresh responses cannot overwrite newer dashboard state.

## Performance

- **Parallelized staff PIN verification**: `functions/src/auth/verify_staff.ts` batches async `scrypt` checks via `findMatchingPinAccount` (concurrency 8) instead of verifying candidate accounts sequentially. Covered in `functions/test/staff_auth.test.js`.
- **Cached `stats_meta/dailyStats` backfill check**: `functions/src/reporting/daily_stats.ts` caches `isDailyStatsBackfilled` once `true` is observed (never caching `false`) and shares it across `functions/src/reporting/aggregator.ts`, `functions/src/reporting/analytics.ts`, and `functions/src/reporting/lifetime_report.ts`. Covered in `functions/test/daily_stats.test.js`.
- **Bounded `getActiveOrders` limit**: `functions/src/orders/kds.ts` accepts an optional caller `limit` clamped to `[1, 200]` via `clampOrdersLimit`; `app/src/staff/dashboard.ts` requests `limit: 50` for the history view. Covered in `functions/test/payment_reconciliation.test.js` and `test/site/staff.test.mjs`.
- **Cache-first immutable SW assets**: `app/public/staff/sw.js` serves hashed `/_astro/*` bundles and `/kiosk/fonts/*` cache-first while keeping network-first for mutable routes. Covered in `test/site/staff.test.mjs`.

## Verification

- `npm run ci`: all steps passed (`functions` build, lint, 41/41 unit tests, runtime audit; `rules` Firestore rules emulator + derived views emulator tests; `site` Astro check, lint, build, runtime audit, storefront tests).
