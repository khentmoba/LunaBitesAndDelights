# Security, Reliability & Bug Fixes Evidence

## Scope

Six fixes across Cloud Functions (`functions/src/`) and the Astro storefront/kiosk/staff app (`app/src/`):

1. **PayMongo webhook HMAC verification before Firestore rate-limit transaction** (`functions/src/payments/webhook.ts`):
   - Moved `verifyWebhookSignature` ahead of `enforceFixedWindowRateLimit` so unauthenticated/spoofed requests are rejected with `401 Invalid signature` in constant time without consuming Firestore read/write quota.
   - Regression test: `functions/test/payment_reconciliation.test.js` (`paymongoWebhook rejects invalid signatures before touching Firestore rate limits`).

2. **Strict staff UID / doc ID validation in `updateStaffPin`** (`functions/src/auth/verify_staff.ts`):
   - Added `staffDocIdFromUid(uid)` requiring the `staff_` prefix and `^[A-Za-z0-9._-]{2,64}$` before constructing `db.collection('staff_accounts').doc(docId)`.
   - Regression test: `functions/test/staff_auth.test.js` (`staffDocIdFromUid validates prefix and document id format`).

3. **KDS post-mutation polling race** (`app/src/staff/kds.ts`):
   - Added `force` flag to `fetchActive(silent = false, force = false)` and pass `fetchActive(true, true)` after `updateOrderStatus` in polling mode so an in-flight pre-mutation poll is superseded via `fetchSeq` instead of silently dropping the post-mutation refresh.
   - Regression test: `test/site/staff.test.mjs`.

4. **Staff modal teardown on gate exit / sign-out** (`app/src/staff/ui.ts`, `app/src/staff/gate.ts`):
   - Tracked open staff `<dialog>` modals in `showDialog` and added `closeAllDialogs()` invoked on staff gate teardown/sign-out before unmounting the screen, preventing orphaned top-layer modals from covering the login screen.
   - Regression test: `test/site/staff.test.mjs` (`showDialog tracks open modals and closeAllDialogs removes them on teardown`).

5. **GCash header back-button guard during payment verification** (`app/src/pages/kiosk/gcash.astro`):
   - Guarded `cancel()` with `if (verifying) return;` and disabled all `[data-cancel]` buttons (both the header back button and the footer Cancel button) while `verifyCheckoutPayment` is in flight so a tap cannot navigate back and strand a confirmed order.
   - Regression test: `test/site/staff.test.mjs`.

6. **Kiosk inactivity bfcache lifecycle hygiene** (`app/src/kiosk/inactivity.ts`):
   - Cleared idle timeout and countdown interval and closed any open idle warning dialog on `pagehide`, and re-armed on persisted `pageshow` so navigating away into bfcache cannot leave stale timers or modal state.
   - Regression test: `test/site/kiosk.test.mjs` (`watchInactivity clears timers and closes idle dialog on pagehide and re-arms on persisted pageshow`).

## Verification

- Full local CI run recorded in `docs/evidence/ci-local.txt` (`npm run ci`), covering:
  - `functions`: TypeScript build, ESLint promise checks, 123 unit tests, npm audit (high/critical)
  - `rules`: Firestore rules emulator tests + Derived views emulator tests
  - `site`: `astro check` (0 errors), ESLint promise checks, `astro build` (17 pages), npm audit (high/critical), 94 storefront tests
- Rendered app verification on static build (`build/app`):
  - Mobile 390×844 (`/kiosk/gcash/` → `/kiosk/checkout` redirect when no pending order): `![lunabites-gcash-390.png](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/lunabites-gcash-390.png?raw=true)`
  - Desktop 1440×900 (`/staff/kds/` staff gate): `![lunabites-staff-kds-1440.png](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/lunabites-staff-kds-1440.png?raw=true)`
