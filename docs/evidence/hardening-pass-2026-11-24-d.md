# Hardening Pass — Performance, Reliability & Security (2026-11-24)

## Summary of Fixes

1. **Performance / Reliability (`functions/src/orders/kds.ts`):**
   - Added `pageSizeForActiveOrders(maxDocs, includeCompleted, remainingScanBudget)` so `getActiveOrders({ includeCompleted: true, limit: 10, summaryOnly: true })` (the staff dashboard hot path) reads 20 Firestore documents per page instead of 50 (60% fewer reads), while keeping the 50+ buffer for active-only KDS queries and clamping every page query to `MAX_SCAN_DOCS - scanned`.
2. **Security / Reliability (`functions/src/reporting/daily_stats.ts`):**
   - Hardened `dayFromDoc()` to ignore non-object or array `d.items` fields and define item keys with `Object.defineProperty` (matching `getOrCreateItemSlot`), preventing prototype mutation on hostile or corrupted `__proto__` keys.
3. **Reliability (`functions/src/orders/place_order.ts`):**
   - Included delivery coordinates (`lat`, `lng`) in `orderPayloadFingerprint()` so a retried delivery order whose map pin changed on the same street is detected as a payload mismatch instead of silently deduplicating against stale coordinates.
4. **Reliability / Concurrency (`app/src/pages/kiosk/checkout.astro`):**
   - Locked checkout form inputs (`readOnly = loading`), ignored mid-submission `input` events, and blocked `[data-pin]` navigation while `placeOrder` is in flight so shoppers cannot wipe `draft.idempotencyKey` mid-request and trigger duplicate orders on retry.
5. **Reliability (`app/src/kiosk/payment-host.ts`, `app/src/pages/kiosk/gcash.astro`):**
   - Added `parseCheckoutSessionResponse()` to validate both the PayMongo HTTPS URL and a non-empty `checkoutSessionId` before entering the ready state, preventing shoppers from being stranded on a ready screen whose verify button permanently fails without a retry path.
6. **Reliability / Offline (`app/src/staff/session.ts`):**
   - Added `tokenErrorAction(code, hasMatchingCurrent)` so a transient `auth/network-request-failed` during `getIdTokenResult()` on an offline PWA reload defers to the login gate without calling `logout()` and wiping the stored Firebase Auth session from IndexedDB.
7. **UX / Reliability (`app/src/pages/kiosk/map.astro`):**
   - Marked `userInteracted = true` when initial auto-geolocation succeeds (so shoppers can confirm their real GPS position immediately, while store-coordinate fallbacks still require pinning) and scoped `locating = false` cleanup to the active `locateSeq` so dragging or searching unblocks the Locate button immediately.
8. **Security / Reliability (`app/public/staff/sw.js`):**
   - Restricted service worker caching to `res.type === 'basic'` responses (never caching opaque responses) and added an `ignoreSearch: true` cache fallback for offline navigation requests (e.g., `/staff/kds?source=pwa`).

## Verification

- Full local CI (`npm run ci`) recorded in `docs/evidence/ci-local.txt`:
  - `functions`: TypeScript build, ESLint, unit tests (`kds_status.test.js`, `daily_stats.test.js`, `payment_reconciliation.test.js`, etc.), and audit.
  - `rules`: Firestore rules emulator tests and Functions + Firestore derived views emulator tests.
  - `site`: `astro check`, ESLint, `astro build`, audit, and `npm run test:site` (107 tests passing, including new tests for `parseCheckoutSessionResponse`, `tokenErrorAction`, opaque SW rejection, and `ignoreSearch` offline navigation fallback).
- Rendered `/kiosk/checkout/` (390px mobile and 1440px desktop) and `/kiosk/map/` (390px mobile) in headless Chromium with 0 console/page errors; screenshots published to the `evidence` branch.
