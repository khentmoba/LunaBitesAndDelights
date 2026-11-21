# Security, reliability, and performance review loop evidence

Five blind, no-context audit rounds were run against this repository using Gemini 4 Neon (medium thinking) in Pi, followed by a two-round `review-loop` (Hy4 Flash Free, high reasoning) before opening the PR.

## Blind audit rounds

- **Round 1 (`e8324e1`):** Tightened single-price cooler entries in `MENU_PRICES` (`Leche Flan`, `Strawberry`, `Ice Cream Halo-Halo`), blocked kitchen preparation alerts when a late GCash payment arrives on a cancelled order (sending a refund-review Telegram alert instead), fixed KDS manual sync discarding polled results when the live listener is active, paginated `backfill-derived-views.js` with `isOrderVisibleInKds` filtering plus `sourceEventMs` and `expireAt` TTLs, raised `updateStaffPin` memory/concurrency to `512MiB` / `10` to match `verifyStaff`, normalized usernames in `reset-staff-credentials.js`, scoped `app/public/staff/sw.js` cache lookups to `CACHE`, and paused the `/kiosk/gcash` inactivity timer while the tab is hidden.
- **Round 2 (`f02e0f1`):** Cloned the KDS kitchen slip into a dedicated `@media print` container so `PRINT SLIP` prints the slip rather than the full board, replaced `data-html` DOM attributes in `app/src/staff/kds.ts` with an in-memory `Map`, moved the `Staff.astro` service worker script into a bundled module and dropped `'unsafe-inline'` from `/staff` `script-src`, capped `getLifetimeSalesReport` fallback scans at 20 pages, distinguished `resource-exhausted` (429) from transient Firestore errors (500) in `paymongoWebhook`, cleared the active countdown dialog/interval when hiding `/kiosk/gcash`, escaped `.` in the cancelled-order MarkdownV2 refund alert, and separated split photo vs. text delivery in `sendDeliveryNotification`.
- **Round 3 (`2dfd0b8`):** Skipped KDS polling ticks while hidden (syncing on visibility return) and passed `includeCompleted: showCompleted`, replaced the 1s print cleanup timer with `afterprint`/`matchMedia('print')` plus a 60s fallback, capped delivery addresses at 300 characters across `checkout.astro`/`map.astro`/`geo.ts` and surfaced `invalid-argument` errors, persisted `photoSent: true` on `order_notifications/{orderDocId}` to avoid duplicate map photos on retry, bounded `staff_accounts` PIN queries with `.select(...).limit(50)`, and bundled the remaining inline script in `kiosk/index.astro` so `/kiosk` also drops `'unsafe-inline'` from `script-src`.
- **Round 4 (`5a0b8c1`):** Halted KDS polling and reconnect timers on `unauthenticated`/`permission-denied` errors, switched `ensureStaffSeeded` to atomic `batch.create`, served `/kiosk/fonts/` stale-while-revalidate in `staff/sw.js`, validated `image/*` Content-Type and 5 MB max size in `fetchMapImage`, awaited `AudioContext.resume()` before scheduling chime oscillators, and replaced `String(Date.now())` cart line IDs with UUIDs in `menu.astro`.
- **Round 5 (`019d231`):** Removed IP-unscoped global and per-username-only password lockout DoS vectors in `verifyStaff` (and removed the `staff1` login placeholder), excluded cancelled and unpaid GCash orders from the dashboard items-sold fallback, added bounded in-memory caching and 800 ms debouncing for Nominatim lookups in `geo.ts`/`map.astro`, removed `loading="lazy"` from the desktop hero photo in `index.astro`, switched `checkRateLimit` to a plain read on the fast path, and batched DOM reads/writes with `requestAnimationFrame` resize throttling in `fit.ts` and `dashboard.ts`.

## Review loop (`Hy4 Flash Free`, high)

- **Round 1 (`CHANGES`):** Caught a blocker (`D1`) where rejecting webhooks with `503` when `process.env.PAYMONGO_WEBHOOK_SECRET` is unset would break production webhooks until the secret is bound via `defineSecret` and provisioned in Secret Manager, and a nit (`D2`) where `analytics.totalItemsSold == null` made the dashboard fallback unreachable. Both passed triage as `IGNORE: no` and were fixed in `bb99adc`.
- **Round 2 (`VERDICT: SHIP`):** Confirmed `D1` and `D2` resolved. Fixed stale comment nit `D3` (`app/src/pages/kiosk/map.astro`); declined no-op timer nit `D4` (`app/src/staff/kds.ts`).

## Deferred items (require production rollout or deployment approval)

- Locking down `orders/{orderId}` and removing legacy `pasugo_*`/`riders` blocks in `firestore.rules` (must remain aligned with production until deployed with explicit approval).
- Provisioning `PAYMONGO_WEBHOOK_SECRET` in Secret Manager and binding it via `defineSecret`.
- Enforcing `enforceAppCheck: true` on public callables (manual Firebase Console rollout per `SECURITY.md`).
- Adding composite Firestore indexes (`firestore.indexes.json`) for status-filtered KDS queries.

## Local verification

- Full CI (`npm run ci`) output recorded in `docs/evidence/ci-local.txt`: `functions` (TypeScript build, ESLint, 60 unit tests, runtime audit), `rules` (23 Firestore rules emulator tests, 2 derived-views emulator tests), and `site` (Astro check, ESLint, Astro build, runtime audit, 61 storefront/kiosk/staff tests) all passed.
- Rendered UI screenshots for the touched surfaces (`storefront-home`, `kiosk-checkout-delivery`, `staff-kds`, `staff-dashboard`) were captured via `tool/parity/shoot.mjs` against the Firebase emulators and published to the `evidence` branch.
