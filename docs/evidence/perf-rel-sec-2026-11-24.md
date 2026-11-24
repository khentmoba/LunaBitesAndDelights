# Performance, Reliability, and Security Fixes — Validation Evidence

## Changes Verified

1. **`updateStaffPin` current-password whitespace parity (`functions/src/auth/verify_staff.ts`)**
   - `parseCurrentPassword` validates password presence and `MAX_PASSWORD_LENGTH` without trimming, matching `verifyPasswordLogin` and `scripts/reset-staff-credentials.js`.
   - Verified via `functions/test/staff_auth.test.js` (`parseCurrentPassword preserves leading/trailing whitespace and rejects invalid inputs`).

2. **Sequential, fault-isolated notification reconciliation (`functions/src/orders/send_notification.ts`)**
   - `runOrderNotificationReconciliation` runs `reconcileMissedOrderNotifications` then `reconcileMissedPaymentNotifications` sequentially with a shared `paidDocs` snapshot and per-pass `.catch(...)` isolation.
   - Prevents concurrent claims on the same `order_notifications/{orderDocId}` doc and avoids doubling Telegram bursts, while ensuring a transient failure in one pass never suppresses the other.
   - Verified via `functions/test/telegram_notification.test.js` (sequential execution + shared query + fault-isolation tests).

3. **KDS unchanged metadata snapshot guard (`app/src/staff/kds.ts`, `app/src/staff/kds-data.ts`)**
   - Captured `const wasLive = isLive` before setting `isLive = true` and extracted `shouldSkipUnchangedLiveSnapshot(wasLive, nextSignature, liveSignature, polledLength)` so reconnecting from polling never falsely skips publishing live orders.
   - Clears `loading` on the unchanged-snapshot fast path only when `!fetchInFlight`, preventing a stuck loading spinner without clobbering an active manual sync.
   - Verified via `test/site/staff.test.mjs`.

4. **Geocoder fallback timer and abort-listener cleanup (`app/src/kiosk/geo.ts`)**
   - `combineSignal` returns `{ signal, cleanup }` and `reverseGeocode` / `searchAddress` invoke `cleanup()` in `finally` so settled requests on the fallback path clear the 8-second timer and detach the caller's abort listener.
   - Verified via `test/site/kiosk.test.mjs` (`combineSignal cleans up fallback timeout and caller abort listener when settled`).

5. **CSPRNG fallback for kiosk idempotency keys (`app/src/kiosk/order.ts`)**
   - `newIdempotencyKey` uses `crypto.getRandomValues` (32 lowercase hex chars, matching `IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/`) before falling back to `Math.random()`.
   - Verified via `test/site/kiosk.test.mjs` (`newIdempotencyKey falls back to crypto.getRandomValues when randomUUID is unavailable`).

## CI Verification

Full local CI run recorded in [`docs/evidence/ci-local.txt`](ci-local.txt):
- `functions`: TypeScript build, ESLint, 114/114 unit tests, runtime audit — all PASS.
- `rules`: Firestore rules emulator tests + derived views emulator tests — all PASS.
- `site`: Astro type check, ESLint, production build, runtime audit, 86/86 storefront/kiosk/staff tests — all PASS.
