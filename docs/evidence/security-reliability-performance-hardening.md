# Security, Reliability, and Performance Hardening Evidence

## Scope

Five independent audit-and-fix rounds covering Firebase Cloud Functions (`functions/src/**`), Firestore TTL indexes (`firestore.indexes.json`), hosting cache headers (`firebase.json`), and the Astro storefront/kiosk/staff app (`app/src/**`), followed by a fresh `review-loop` pass (Round 1 verdict: `SHIP`).

## Key Changes Verified

- **Payments & PayMongo reconciliation**
  - Fixed PayMongo webhook JSON:API envelope parsing (`functions/src/payments/webhook.ts`) and moved signature-format validation ahead of HMAC comparison (`functions/src/util/security.ts`).
  - Added PayMongo payment amount verification (`paidPaymentAmountCentavos`), distinguished permanent 400/404 from transient fetch failures, and tracked multiple concurrent `checkoutSessionIds` so webhooks reconcile whichever session the customer pays (`functions/src/payments/paymongo.ts`, `functions/src/payments/create_checkout.ts`, `functions/src/payments/verify_payment.ts`).
  - Priced checkout sessions strictly from persisted order items and rejected `createPayMongoCheckout` on orders already marked `PAID`.
- **Staff auth & rate limiting**
  - Fixed `clientIpFromRequest` to take the rightmost XFF entry (Cloud Run / GFE appends the real client IP on the right) and hardened `rate_limits` window budgets across PIN login, password login, and PIN updates (`functions/src/util/security.ts`, `functions/src/auth/verify_staff.ts`).
  - Required `currentPassword` verification on `updateStaffPin`, upgraded legacy password hashes on successful PIN update, and added TTL `expireAt` fields with matching `firestore.indexes.json` TTL policies.
- **Orders, idempotency, notifications, and reporting**
  - Derived deterministic order doc IDs from `idempotencyKey` with full payload fingerprinting so retries return the existing order and mismatched payloads fail cleanly (`functions/src/orders/place_order.ts`).
  - Enforced valid KDS status transitions and bounded `getActiveOrders` queries (`functions/src/orders/kds.ts`).
  - Added Telegram MarkdownV2 chunking (`splitTelegramMessage`), 1024-char delivery caption bounding (`formatDeliverySummaryCaption`), server-derived timestamps, and stale-lease recovery (`functions/src/telegram_api.ts`, `functions/src/orders/send_notification.ts`, `functions/src/orders/derived.ts`).
  - Hardened `safeDateLabel` and paginated non-backfilled `lifetime_report` scans (`functions/src/reporting/daily_stats.ts`, `functions/src/reporting/lifetime_report.ts`).
- **Kiosk & Staff App**
  - Fixed checkout idempotency key staleness on cart edits, bounded item quantities (`<= 99`), added inactivity reset on kiosk `map` and `gcash` pages, preserved KDS scroll position and checked-item state across refreshes, and eager-loaded the first 4 visible menu cards for LCP (`app/src/**`).
  - Added immutable cache headers for `/_astro/**` and `/kiosk/fonts/**` in `firebase.json`.

## Local CI Verification

Full local CI (`npm run ci`) output is recorded in `docs/evidence/ci-local.txt`:

- `functions`: TypeScript build, ESLint promise checks, unit tests (`payment_reconciliation.test.js`, `telegram_notification.test.js`, `staff_auth.test.js`, `daily_stats.test.js`), and `npm audit --omit=dev --audit-level=high`.
- `rules`: Firestore rules emulator tests and derived views emulator tests (`firestore.rules` untouched).
- `site`: Astro type check, ESLint, static build, runtime audit, and storefront tests.
