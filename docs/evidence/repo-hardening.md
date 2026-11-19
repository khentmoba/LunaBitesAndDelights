# Security, Reliability, and Performance Hardening

Verified via `npm run ci` (summary in `docs/evidence/ci-local.txt`).

## Security

- **Server-validated order placement**: Added `placeOrder` callable in `functions/src/orders/place_order.ts` and exported it from `functions/src/index.ts`. Recomputes item prices and totals against `functions/src/payments/create_checkout.ts` (`validateAndPriceItems`) before writing `orders`. `app/src/kiosk/order.ts` calls `placeOrder` first and only falls back to direct Firestore write if `not-found`/`unimplemented` (pre-deploy rollout).
- **Authoritative Telegram notifications**: `functions/src/orders/send_notification.ts` now reads the order document from Firestore via `orderDocId` instead of trusting client-supplied items/totals/payment status, and uses a transaction-guarded `telegramNotifiedAt` claim so duplicates cannot fire.
- **PayMongo webhook replay protection**: `functions/src/payments/webhook.ts` verifies the `t=` signature timestamp against a ±5 minute replay window. Covered in `functions/test/payment_reconciliation.test.js`.
- **Content-Security-Policy & font caching**: Added `Content-Security-Policy` (including `https://maps.google.com` and `https://www.google.com` in `frame-src` for landing-page embeds and reCAPTCHA) and a 30-day `Cache-Control` header for `**/*.woff2` in `firebase.json`. Covered in `test/site/hosting.test.mjs`.
- **CI workflow hardening**: Pinned `actions/checkout` and `actions/setup-node` to full commit SHAs and moved temporary service account files from `$HOME` to `$RUNNER_TEMP` in `.github/workflows/firebase-hosting-merge.yml`, `.github/workflows/firebase-hosting-pull-request.yml`, and `.github/workflows/rules-drift.yml`.

## Reliability

- **Trigger-driven Telegram delivery**: `functions/src/orders/derived.ts` (`onOrderWritten`) triggers Telegram delivery on order creation (for Cash/Walk-In) or when GCash transitions to `PAID`, preventing lost notifications if a customer closes the browser after checkout.
- **PayMongo API resilience**: `functions/src/payments/paymongo.ts` adds a 10-second `AbortController` timeout and retry on 429/5xx/network errors. `functions/src/payments/verify_payment.ts` writes `paymentStatus: 'PAID'` inside a Firestore transaction to prevent duplicate notifications under concurrent webhook + client verification.
- **Collision-resistant order IDs**: `app/src/kiosk/order.ts` appends a 3-character random suffix to `LU-YYMMDD-HHMMSS` order numbers. Covered in `test/site/kiosk.test.mjs`.
- **App Check before first call**: `app/src/kiosk/firebase.ts` awaits `initializeAppCheck` before returning the Firebase app instance.
- **KDS auto-reconnect & lookback refresh**: `app/src/staff/kds.ts` retries the Firestore live listener every 60s when in polling fallback, clears `polled` when live resumes, and refreshes the 24h lookback window every 6 hours.

## Performance

- **Native `fetch` Telegram client**: Replaced `node-telegram-bot-api` (and its legacy `request` dependency tree) in `functions/src/telegram_api.ts` and `functions/package.json` with native Node `fetch` + `FormData` and a 10s timeout. Covered in `functions/test/telegram_notification.test.js`.
- **Non-blocking scrypt**: `functions/src/util/security.ts` and `functions/src/auth/verify_staff.ts` use async `crypto.scrypt` so PIN/password verification does not block the Cloud Functions event loop. Covered in `functions/test/staff_auth.test.js`.
- **Daily sales aggregator fast-path & TTL**: `functions/src/reporting/aggregator.ts` reads `dailyStats/{dateLabel}` (1 read) when `stats_meta/dailyStats` is backfilled instead of scanning all `orders`, and `firestore.indexes.json` configures a TTL policy on `stats_events.expireAt`.
- **Targeted DOM updates & SW cache pruning**: `app/src/staff/kds.ts` starts the live listener first (falling back to `getActiveOrders` only if no snapshot arrives in 4s) and updates elapsed timestamps in place; `app/src/staff/login.ts` updates PIN slots in place; `app/public/staff/sw.js` prunes `/_astro/` cache entries to 40.

## Verification

- `npm run ci`: all steps passed (`functions` build, lint, unit tests, audit; `rules` Firestore rules + derived views emulator tests; `site` Astro check, lint, build, audit, 60/60 storefront tests).
