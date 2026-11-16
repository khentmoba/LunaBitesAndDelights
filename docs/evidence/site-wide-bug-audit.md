# Site-wide bug audit fixes

## Summary of fixes

- **Cloud Functions — `sendOrderNotification` verification & idempotency** (`functions/src/orders/send_notification.ts`):
  - Requires a valid `orderDocId`, verifies the `orders/{orderDocId}` document exists and its `orderId` matches `orderNumber`, and short-circuits with `{ success: true, alreadySent: true }` when `telegramSent === true`.
  - Updated `docs/evidence/order-notification-probe.cjs` to assert the repeat-call idempotency return and use a separate `notificationRegressionFail` document for the simulated failure case.
- **Cloud Functions — PayMongo webhook session ID validation** (`functions/src/payments/webhook.ts`):
  - Validates `event.data.id` against `/^[A-Za-z0-9_-]{4,128}$/` before calling `fetchSessionPayments`.
- **Cloud Functions — Transactional login rate-limit check** (`functions/src/util/security.ts`):
  - Runs `checkRateLimit` inside `db.runTransaction` so expired lockouts are checked and deleted atomically.
- **Kiosk — Map picker fallbacks** (`app/src/pages/kiosk/map.astro`):
  - Falls back to `address` (`display_name`) when `shortAddress(r.address)` is empty on search selection.
  - Falls back to a default `CheckoutDraft` in `confirm()` when `DRAFT` is absent from `sessionStorage`.
- **Kiosk — Cart swipe-to-remove reliability** (`app/src/pages/kiosk/cart.astro`):
  - Adds a 250 ms timeout fallback alongside `transitionend` (guarded by `removed`) so swiped items are always removed.
- **Kiosk — Splash `?pick=` preservation for staff** (`app/src/pages/kiosk/index.astro`):
  - Only redirects `.splash__start` to `/staff/dashboard` when `!location.search`.
- **Staff — KDS clipboard & mobile `DONE` tab** (`app/src/staff/kds.ts`):
  - Checks `navigator.clipboard?.writeText` and reports errors on rejection instead of always showing success.
  - Enables `showCompleted` and calls `publish()` when the mobile `DONE` tab (`tab === 3`) is selected.
- **Staff — Lifetime report custom range PHT default** (`app/src/staff/reports.ts`):
  - Computes the 30-day default start date from `phtToday()` instead of UTC `Date.now()`.

## Local verification

| Check | Result | Notes |
| --- | --- | --- |
| `npm run test:site` | 52 passed, 0 failed | |
| `app`: `npm run check` | 0 errors, 0 warnings, 0 hints | 53 files checked |
| `app`: `npm run build` | 17 pages built | |
| `app`: `npm audit --audit-level=high` | Exit 0 | 0 high/critical |
| `functions`: `npm test` | 31 passed, 0 failed | Includes `tsc` build |
| `functions`: `npm audit --audit-level=high` | Exit 0 | 0 high/critical |
| `functions`: `npm run test:rules` | Skipped locally | Requires Java >= 21; runs in CI |

## Out-of-scope / follow-up items

- `firestore.rules` was left untouched to match production (`check:rules-drift`). Tightening public `orders` create validation and retiring/locking down legacy `pasugo_errands` / `pasugo_sessions` rules requires explicit user approval and a rules deployment.
