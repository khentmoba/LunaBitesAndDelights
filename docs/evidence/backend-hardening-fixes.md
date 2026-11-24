# Backend Security, Reliability, and Data-Hygiene Fixes

## Summary of Fixes

1. **Expired login lockout reset** (`functions/src/util/security.ts`)
   - Added `nextLoginFailureState(existing, nowMs)` and updated `recordLoginFailure` so an expired lockout (`fails >= MAX_ATTEMPTS` with `lockedUntil <= now`) resets to `fails = 1` and clears stale `lockedUntil` via a full document write instead of immediately re-locking on a single miss.
2. **KDS & Telegram numeric/coordinate sanitization** (`functions/src/orders/kds.ts`, `functions/src/orders/send_notification.ts`)
   - Clamped non-finite and negative `price`, `quantity`/`qty`, `deliveryFee`, and `totalAmount` values via `finiteNumber`, validated `lat`/`lng` coordinate bounds (`|lat| <= 90`, `|lng| <= 180`), and guarded against null item entries.
3. **Prototype-key safety in reporting aggregations** (`functions/src/reporting/daily_stats.ts`, `functions/src/reporting/aggregator.ts`, `functions/src/reporting/analytics.ts`)
   - Switched `itemCounts` maps to `Object.create(null)` and used `getOrCreateItemSlot` (`Object.prototype.hasOwnProperty` + `Object.defineProperty`) in `daily_stats.ts` so item names matching `Object.prototype` keys (`constructor`, `toString`, `__proto__`) cannot crash or pollute prototypes.

## Verification

- `functions/test/staff_auth.test.js`: verifies `nextLoginFailureState` (initial failure, lockout threshold, expired-lockout reset, active-lockout extension).
- `functions/test/payment_reconciliation.test.js`: verifies `projectOrder`/`projectOrderSummary` clamping of non-finite/negative numbers, invalid coordinates, and null items.
- `functions/test/telegram_notification.test.js`: verifies `notificationDataFromOrder` clamping of non-finite/negative amounts, fees, prices, and quantities.
- `functions/test/daily_stats.test.js`: verifies `daysFromOrders`, `salesAnalyticsFromDay`, and `lifetimeReportFromDays` with `constructor`, `toString`, and `__proto__` item names.
- Full local CI gate (`npm run ci`): see `docs/evidence/ci-local.txt`.
