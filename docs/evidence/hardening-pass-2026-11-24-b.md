# Hardening Pass — Security, Reliability, Performance & Lifecycle Fixes (2026-11-24)

## Summary of Fixes

1. **Rate-limit cleanup re-lock enforcement** (`functions/src/util/security.ts`):
   - Inside `checkRateLimit`'s expired-lockout cleanup transaction, re-check `lockedUntil > now` before deleting the stale doc so a concurrent failure that re-locked the key is enforced instead of deleted.
   - Covered by `checkRateLimit re-enforces lockout when a concurrent failure re-locks inside the cleanup transaction` in `functions/test/staff_auth.test.js`.

2. **Skip unnecessary KDS mirror delete transactions** (`functions/src/orders/derived.ts`):
   - Added `shouldDeleteKdsMirror(before, after)` so `onOrderWritten` only runs a Firestore delete transaction when the order was previously visible in KDS (`kdsVisible(before)`), avoiding wasted transactions on unpaid/expired GCash lifecycle transitions.
   - Covered by `shouldDeleteKdsMirror skips delete transactions for orders never visible in KDS` in `functions/test/hardening_baseline.test.js`.

3. **Preserve existing cancellation reason on duplicate cancel calls** (`functions/src/orders/kds.ts`):
   - Extracted `buildStatusUpdate(current, status, reason)` so duplicate `Cancelled -> Cancelled` calls never overwrite an already-recorded `cancellationReason` (e.g., `Payment session expired`), while still allowing backfill when missing.
   - Covered by `buildStatusUpdate preserves an existing cancellationReason on duplicate Cancelled calls` in `functions/test/hardening_baseline.test.js`.

4. **Lock checkout order-type tiles while submitting & snapshot receipt/GCash handoff** (`app/src/pages/kiosk/checkout.astro`):
   - Ignored order-type/payment tile clicks while `loading` is true and built receipt/GCash handoff fields (`isWalkIn`, `orderType`, `paymentMethod`) from the submitted `order` snapshot rather than mutable `draft` state.

5. **Clean up KDS print slip host, listeners, and timeout on teardown/re-print** (`app/src/staff/kds.ts`):
   - Tracked `activePrintCleanup` so repeated print clicks or view teardown before `afterprint` immediately remove `.kslip-print`, clear the fallback timeout, detach the `afterprint` listener, and remove `is-printing-slip` from `document.body`.
   - Covered by `mountKds cleans up print slip host and body class on teardown before afterprint` in `test/site/staff.test.mjs`.

6. **Log out instead of opening stale dashboard history sheet on expanded-fetch auth error** (`app/src/staff/dashboard.ts`):
   - Checked `isAuthCode(e.code)` / `isAuthErrorText(...)` when `getActiveOrders({ limit: 50 })` fails while opening the history sheet, triggering `logout()` instead of rendering stale data.
   - Covered by `mountDashboard logs out instead of opening stale order sheet on expanded-fetch auth error` in `test/site/staff.test.mjs`.

7. **Guard `watchInactivity` against duplicate `showModal()` and leaked countdown interval** (`app/src/kiosk/inactivity.ts`):
   - Returned early in `warn()` if `dialog.open` is already true (or document is hidden when `pauseWhenHidden`), and cleared any existing `tick` interval before starting a new countdown.
   - Covered by `watchInactivity ignores duplicate warn while dialog is open without throwing` in `test/site/staff.test.mjs`.

## Verification

- Local CI gate (`npm run ci`): recorded in `docs/evidence/ci-local.txt`.
- Rendered UI screenshots published to `evidence` branch:
  - `docs/evidence/hardening-pass-2-checkout-390.png` (390x844)
  - `docs/evidence/hardening-pass-2-staff-1440.png` (1440x900)
