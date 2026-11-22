# Architecture & Codebase Map

Single-deploy Astro 7 + TypeScript frontend (`app/`) and Firebase Cloud Functions v2 backend (`functions/`) on Firebase Hosting & Firestore.

## Directory Map

- `app/src/pages/` — Astro routes built to `build/app/`:
  - `index.astro`, `menu/index.astro` — Public storefront (`/` and `/menu/`). Intentionally inline their critical CSS and `<script is:inline>` for 1-RTT first paint on low-end mobile data (enforced by `test/site/app.test.mjs`).
  - `kiosk/*.astro` — Ordering app (`/kiosk/`, `/kiosk/menu/`, `/kiosk/cart/`, `/kiosk/map/`, `/kiosk/checkout/`, `/kiosk/gcash/`, `/kiosk/receipt/`).
  - `staff/*.astro` — Staff console (`/staff/`, `/staff/dashboard/`, `/staff/kds/`, `/staff/analytics/`, `/staff/lifetime/`).
  - `payment/success.astro`, `payment/cancel.astro` — PayMongo return pages (`/payment/success/`, `/payment/cancel/`).
- `app/src/kiosk/` — Kiosk TypeScript modules (`firebase.ts`, `cart.ts`, `order.ts`, `geo.ts`, `inactivity.ts`, `payment-host.ts`, `preselect.ts`, `fit.ts`).
- `app/src/staff/` — Staff TypeScript modules (`dashboard.ts`, `kds.ts`, `kds-data.ts`, `reports.ts`, `report-data.ts`, `session.ts`, `gate.ts`, `ui.ts`).
- `app/src/data/menu.ts` — Canonical menu sections, item IDs, variants, and prices.
- `app/public/staff/sw.js` — Installable staff PWA service worker (network-first HTML, cache-first `/_astro/**`, SWR `/kiosk/fonts/**`).
- `app/public/kiosk/sw.js`, `app/public/kiosk/flutter_service_worker.js` — Retirement workers that clear legacy Flutter caches and unregister themselves (tested by `tool/parity/sw_retire.mjs`; do not delete).
- `functions/src/index.ts` — Calls `initializeApp()` and `setGlobalOptions({ maxInstances: 10 })` before re-exporting all triggers and callables.
- `functions/src/secrets.ts` — `defineSecret` bindings (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `PAYMONGO_SECRET_KEY`, `GOOGLE_MAPS_API_KEY`).
- `functions/src/auth/verify_staff.ts` — Salted `scrypt` staff login (`verifyStaff`) and PIN rotation (`updateStaffPin`).
- `functions/src/orders/` — `place_order.ts` (server-priced order creation), `derived.ts` (`onOrderWritten` trigger updating `kds_orders`, `dailyStats`, and Telegram alerts), `send_notification.ts` (Telegram delivery + scheduled reconciler), `kds.ts` (`getActiveOrders`, `updateOrderStatus`), `expire_unpaid.ts` (daily 24h `AWAITING_PAYMENT` sweep).
- `functions/src/payments/` — `create_checkout.ts`, `verify_payment.ts`, `webhook.ts`, `paymongo.ts` (`markOrderPaidOnce`).
- `functions/src/reporting/` — `analytics.ts`, `lifetime_report.ts`, `daily_report.ts`, `manual_report.ts`, `daily_stats.ts`.
- `functions/scripts/` — Operational scripts (`check-firestore-rules-drift.js`, `check-prod-config.js`, `backfill-derived-views.js`, `reset-staff-credentials.js`).
- `test/site/` — Storefront, kiosk, staff, price-parity, hosting/CSP, file-reference, and local-CI tests (`npm run test:site`).
- `functions/test/` — Backend unit tests (`test/*.test.js`) and Firebase emulator tests (`test/emulator/firestore-rules.test.js`, `test/emulator/derived-views.test.js`).
- `tool/` — `ci-local.mjs` (`npm run ci`), `publish_evidence.mjs`, `png_diff.mjs`, `check_pr_proof.mjs`, `with-java21.mjs`, `perf_probe.mjs`, and `tool/parity/`.

## Coupled Invariants

1. **Menu prices:** `app/src/data/menu.ts` ↔ `MENU_PRICES` / `VARIANT_PRICES` in `functions/src/payments/create_checkout.ts` (also imported by `place_order.ts`). Guarded by `test/site/price-parity.test.mjs`.
2. **CSP & inline scripts:** `firebase.json` headers ↔ `app/src/pages/**`. `/` and `/menu/` allow inline scripts; `/kiosk/**`, `/staff/**`, and `/payment/**` omit `'unsafe-inline'` in `script-src`. Guarded by `test/site/hosting.test.mjs`.
3. **Order schema & statuses:** `firestore.rules` (`orders/{orderId}`) ↔ `app/src/kiosk/order.ts` (`statusesFor`) and `functions/src/orders/place_order.ts`. Guarded by `test/site/kiosk.test.mjs` and `functions/test/emulator/firestore-rules.test.js`.
4. **Firestore TTL collections:** Any collection writing `expireAt` (`kds_orders`, `login_attempts`, `rate_limits`, `order_notifications`, `daily_reports_sent`) ↔ `firestore.indexes.json` `fieldOverrides`. Guarded by `functions/test/hardening_baseline.test.js`.
