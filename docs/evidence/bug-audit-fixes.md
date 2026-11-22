# Bug Audit Fixes Evidence

## Problem

A full audit of `functions/src/`, `app/src/`, `firestore.rules`, and `firestore.indexes.json` turned up 10 concrete bugs across security rules, payment/notification reliability, order expiration, and kiosk/staff UI state:

1. Unauthenticated direct Firestore writes to `orders/{orderId}` did not validate `type`, `paymentMethod`, `dateLabel`, or cap `totalAmount` tightly, allowing unauthenticated callers to forge `Walk-In` orders, arbitrary payment methods, malformed date labels, or ₱1,000,000 totals.
2. `pasugo_errands` update rules allowed any unauthenticated user to cancel any available errand (the `customerPhone == customerPhone` check was a tautology under `affectedKeys().hasOnly(['status'])`), and `pasugo_sessions/{sessionId}/messages` create rules allowed any authenticated non-participant to post messages.
3. `reconcileMissedOrderNotifications` filtered only by `timestamp >= now - 2h`, missing GCash orders created >2h earlier that were paid recently (`paidAt`).
4. Staff POS checkout (`app/src/pages/kiosk/checkout.astro`) set `isWalkIn: isStaff`, hiding customer name, address, and phone and showing walk-in copy on Delivery and Pickup receipts placed by staff.
5. Staff dashboard (`app/src/staff/dashboard.ts`) had no in-flight guard on `showSheet()` (rapid taps stacked duplicate dialogs and RPCs), silently ignored non-throwing `{ success: false }` responses in `fetchData()`, and hardcoded `ADMIN DASHBOARD` for non-admin staff.
6. KDS `refreshElapsedTimes()` (`app/src/staff/kds.ts`) overwrote the high-contrast `INK` color on delayed tickets with `elapsedColor()` on subsequent 30-second ticks.
7. KDS `updateStatus()` toggled the board-wide `loading` boolean while allowing concurrent per-order updates in `updating`, causing concurrent updates to race on the header sync state.
8. `daily_reports_sent` wrote `expireAt` (+30d) but had no TTL `fieldOverrides` entry in `firestore.indexes.json`.
9. `expireStaleUnpaidOrders` overwrote `cancellationReason` on already-cancelled orders and did not paginate past 200 `AWAITING_PAYMENT` docs.
10. `paymongoWebhook` checked only `parts.li || parts.te` instead of all present signature digests, and used the same 120/min IP rate limit even when `PAYMONGO_WEBHOOK_SECRET` was unset.

## Changes Verified

- **Firestore rules (`firestore.rules`, `functions/test/emulator/firestore-rules.test.js`):**
  - Non-staff `orders` creates now require `totalAmount <= 50000`, `type in ['Pickup', 'Delivery']` when present, `paymentMethod in ['Cash', 'GCash']` when present, and `dateLabel` matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` when present.
  - `pasugo_errands` cancellation now requires an authenticated approved rider or staff; `pasugo_sessions/{sessionId}/messages` creation now requires the session's `riderId` or staff.
- **Delayed GCash notification reconciliation (`functions/src/orders/send_notification.ts`, `functions/test/emulator/derived-views.test.js`):**
  - `reconcileMissedOrderNotifications` now queries both recent `timestamp` and recent `paidAt` (single-field queries, deduplicated by doc ID), catching delayed GCash payments without requiring a composite index.
- **Stale unpaid expiration & TTLs (`functions/src/orders/expire_unpaid.ts`, `firestore.indexes.json`, `functions/test/hardening_baseline.test.js`):**
  - `expireUnpaidUpdate` sets `paymentStatus: 'PAYMENT_EXPIRED'` without clobbering `status` or `cancellationReason` on already-`Cancelled` or `Completed` orders, and the scheduled sweep paginates up to 10 pages (2,000 docs).
  - Added `daily_reports_sent.expireAt` TTL override to `firestore.indexes.json`.
- **PayMongo webhook hardening (`functions/src/payments/webhook.ts`, `functions/test/payment_reconciliation.test.js`):**
  - Verifies against all valid 64-hex digests (`li` and `te`) when `PAYMONGO_WEBHOOK_SECRET` is configured, and tightens the IP rate limit to 30/min when the secret is unset.
- **Kiosk & Staff UI fixes (`app/src/pages/kiosk/checkout.astro`, `app/src/staff/dashboard.ts`, `app/src/staff/kds.ts`, `test/site/staff.test.mjs`):**
  - Receipt sets `isWalkIn: draft.orderType === 'Walk-In'`.
  - Dashboard guards `showSheet()` with `sheetLoading`, surfaces non-throwing `success !== true` errors, and renders `ADMIN DASHBOARD` vs `STAFF DASHBOARD`.
  - KDS preserves `delayed ? INK : elapsedColor(ts, now)` on elapsed-time ticks and removes board-wide `loading` mutations from `updateStatus()`.

## Blast-Radius Proof

- **Invariant:** Tightening `firestore.rules` and `expireUnpaidUpdate` never breaks valid kiosk/staff checkout writes or already-cancelled orders, and adding the `paidAt` query to `reconcileMissedOrderNotifications` uses only Firestore's automatic single-field index while deduplicating by order document ID.
- **Verification (Level 4, real Firestore + Functions emulators):**
  - `functions/test/emulator/firestore-rules.test.js`: Every existing checkout fixture (`kiosk-cash`, `kiosk-gcash`, `staff-cash`, `staff-gcash`, `order-create`) passes, while forged `type: 'Walk-In'`, invalid `paymentMethod`/`dateLabel`, `totalAmount > 50000`, unauthenticated errand cancel, and stranger chat message creation are rejected.
  - `functions/test/emulator/derived-views.test.js`: A GCash order created 5 hours ago and paid 2 minutes ago is discovered and notified by `reconcileMissedOrderNotifications`, and a second run is a clean no-op.
  - `functions/test/hardening_baseline.test.js`, `functions/test/payment_reconciliation.test.js`, and `test/site/staff.test.mjs` cover expiration patch preservation, `daily_reports_sent` TTL presence, dual `li`/`te` signature matching, and UI regressions.

## Local CI Verification

Recorded in `docs/evidence/ci-local.txt` via `npm run ci`.
