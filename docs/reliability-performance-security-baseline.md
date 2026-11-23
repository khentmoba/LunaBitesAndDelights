# Reliability, Performance & Security Baseline

**Baseline Commit:** `d060c11` (post PR #73 & PR #74 hardening)
**Captured:** 2026-11-24
**Scope:** Astro frontend (`app/`), Firebase Cloud Functions v2 (`functions/`), Firestore & Storage rules (`firestore.rules`, `storage.rules`, `firestore.indexes.json`), Firebase Hosting config (`firebase.json`), and CI (`.github/workflows/pr-checks.yml`).

This document establishes a verifiable baseline of controls already in place and a prioritized backlog of remaining **Security**, **Reliability**, and **Performance** improvements for future iterations.

---

## 1. Current Hardened Baseline (Already Implemented)

The following controls reflect the codebase reviewed on 2026-11-24 (see also `docs/evidence/perf-reliability-security-2026-11-24.md`, `docs/evidence/security-reliability-performance-hardening.md`, and `docs/evidence/security-reliability-performance-review-loop.md`):

- **Server-side pricing & order creation:** `placeOrder` (`functions/src/orders/place_order.ts`) re-prices all line items against `MENU_PRICES` / `VARIANT_PRICES`, assigns `totalAmount`, `dateLabel`, `timestamp`, `status`, `paymentStatus`, and `entryType` server-side, and deduplicates retries via `idempotencyKey` + payload SHA-256 fingerprint.
- **Payment reconciliation:** `createCheckoutSession` (`functions/src/payments/create_checkout.ts`) reuses active sessions (45m window) and validates against the persisted order doc. `verifyCheckoutPayment` (`functions/src/payments/verify_payment.ts`) and `paymongoWebhook` (`functions/src/payments/webhook.ts`) verify session ownership and exact centavo amounts directly against PayMongo; the webhook additionally requires the provisioned HMAC secret and rejects missing/invalid signatures before API reconciliation.
- **Staff authentication & rate limiting:** `verifyStaff` and `updateStaffPin` (`functions/src/auth/verify_staff.ts`) use per-user salted `scrypt` (`512MiB`, concurrency `10`), atomic seeding (`batch.create`), IP-scoped fixed-window rate limits, and per-account/IP lockouts backed by TTL-enabled `login_attempts` and `rate_limits` collections.
- **Derived views & notification deduplication:** `onOrderWritten` (`functions/src/orders/derived.ts`, `retry: true`) maintains `kds_orders` (with `sourceEventMs` out-of-order guard and TTL), `dailyStats` (with `stats_events` idempotency guard), and Telegram notifications (deduplicated via `order_notifications/{orderDocId}` with `photoSent` persistence and 10m stale-retry cutoff).
- **Storage & Hosting headers:** `storage.rules` is default-deny. `firebase.json` enforces HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `COOP`, immutable caching for `/_astro/**`, and strict CSP without `'unsafe-inline'` in `script-src` for `/staff/**` and `/kiosk/**`.
- **Frontend performance & KDS resilience:** Lazy Firebase SDK imports (`app/src/kiosk/firebase.ts`), `firestore/lite` on checkout, bounded Nominatim caching + 800ms debounce (`app/src/kiosk/geo.ts`), rAF-throttled layout fitting (`fit.ts`, `dashboard.ts`), hidden-tab KDS polling pause, auth-error timer teardown, keyboard-accessible KDS tabs, and navigation-cache bounds in `app/public/staff/sw.js`.
- **Dashboard payloads:** Staff dashboard summary calls select persisted `itemsCount` rather than transferring complete `items[]` and order coordinates, phone numbers, or addresses.
- **CI regression gates:** `.github/workflows/pr-checks.yml` enforces TypeScript builds, ESLint promise checks, unit tests, Firestore rules emulator tests, derived-views emulator tests, Astro checks/tests, and `npm audit --omit=dev --audit-level=high`.

---

## 2. Security Improvements Backlog

| ID | Priority | Status | Type | Area | Summary |
|---|---|---|---|---|---|
| **SEC-01** | Critical | Pending (prod-gated) | Prod-gated | `firestore.rules` | Direct unauthenticated client `create` on `orders/{orderId}` bypasses `placeOrder` |
| **SEC-02** | High | Pending (prod-gated) | Prod-gated | `firestore.rules` | Legacy `pasugo_errands` / `pasugo_sessions` / `riders` rules expose public PII & allow unauthenticated writes |
| **SEC-03** | High | Resolved (secret provisioned; HMAC required) | Code-only | `functions/src/payments/webhook.ts` | `PAYMONGO_WEBHOOK_SECRET` is bound via `defineSecret`; webhook signature verification fails closed when missing or invalid |
| **SEC-04** | High | Pending (prod-gated) | Prod-gated | Public `onCall` functions | `enforceAppCheck: true` not enabled on public callables |
| **SEC-05** | Medium | Resolved (scoped) | Code-only | `firebase.json` | Strict `script-src` without `'unsafe-inline'` extended to `/payment/**` (alongside `/kiosk/**` and `/staff/**`); static `/` and `/menu/` intentionally retain inline JS for 1-RTT 2G/3G first paint |
| **SEC-06** | Medium | Resolved | Code-only | `functions/src/orders/place_order.ts` | Non-staff `placeOrder` calls ignore client `orderId` and always generate `serverOrderNumber()` |
| **SEC-07** | Low | Resolved | Code-only | `functions/src/orders/derived.ts` | `KDS_MIRROR_TTL_MS` reduced from 30 days to 10 days |
| **SEC-08** | Low | Resolved | Code-only | `functions/src/util/security.ts` | `clientIpFromRequest` falls back to `socket.remoteAddress`, and logs once per 10 minutes when no client IP is derivable |
| **SEC-09** | Medium | Resolved | Code-only | `functions/scripts/backfill-derived-views.js` | Backfill wrote a 30-day `kds_orders` `expireAt` while the trigger writes 10 days, reintroducing the PII retention `SEC-07` removed |
| **SEC-10** | Medium | Resolved | Code-only | `functions/src/auth/verify_staff.ts` | The global PIN *attempt* budget reused the 20-failure cap, so ordinary successful sign-ins could lock the whole team out of PIN login |

### Details

#### SEC-01 — Lock down direct client writes to `orders/{orderId}`
- **Where:** `firestore.rules:14-39`, `app/src/kiosk/order.ts:212-227`
- **Risk:** Although the kiosk now submits orders through `placeOrder`, Firestore rules still permit unauthenticated `create` on `orders/{orderId}` with client-chosen `totalAmount`, `items`, `dateLabel`, and payment fields. Because `onOrderWritten` triggers on every `orders` document write, a direct client write bypasses `placeOrder` rate limits and server pricing, injects fake Cash orders into `kds_orders`, pollutes `dailyStats`, and triggers kitchen Telegram alerts.
- **Remediation:** Once `placeOrder` is confirmed live in production, remove the direct-write fallback in `app/src/kiosk/order.ts` and change `orders/{orderId}` in `firestore.rules` to `allow read, write: if false;` (deploying rules with explicit approval).

#### SEC-02 — Retire legacy `pasugo_*` and `riders` Firestore rules
- **Where:** `firestore.rules:66-163`
- **Risk:** `pasugo_errands` allows `allow list: if true` (exposing customer names, phone numbers, and locations) and unauthenticated `create` / `update` (the `available -> cancelled` check `request.resource.data.customerPhone == resource.data.customerPhone` is trivially satisfied by any unauthenticated caller omitting `customerPhone` from a partial update). `pasugo_sessions/{sessionId}/messages` allows any authenticated user to write messages into any active session without verifying session membership.
- **Remediation:** Confirm zero production usage (matching `storage.rules` which already removed rider document access) and remove these rule blocks so they fall through to default deny.

#### SEC-03 — Require PayMongo webhook HMAC verification
- **Status:** Resolved. `PAYMONGO_WEBHOOK_SECRET` is provisioned in production (v1), bound through `defineSecret`, and mandatory on `paymongoWebhook`; invalid or absent signatures fail closed before API reconciliation.
- **Proof:** `functions/test/hardening_baseline.test.js` verifies HMAC/timestamp validation and fail-closed behavior; see `docs/evidence/perf-reliability-security-2026-11-24.md`.

#### SEC-04 — Enforce Firebase App Check on public callables
- **Where:** `functions/src/orders/place_order.ts`, `functions/src/payments/create_checkout.ts`, `functions/src/payments/verify_payment.ts`, `functions/src/orders/send_notification.ts`, `functions/src/auth/verify_staff.ts`
- **Risk:** The client initializes reCAPTCHA Enterprise App Check when `PUBLIC_RECAPTCHA_SITE_KEY` is configured (`app/src/kiosk/firebase.ts:37-46`), but backend callables do not set `enforceAppCheck: true`, allowing direct scripted invocation.
- **Remediation:** Monitor App Check token metrics in Firebase Console, then enable `enforceAppCheck: true` on all public callables.

#### SEC-05 — Remove `'unsafe-inline'` from global `script-src` CSP
- **Where:** `firebase.json:33`, `app/src/pages/index.astro`, `app/src/pages/menu/index.astro`, `app/src/pages/payment/**`
- **Risk:** `/staff/**` and `/kiosk/**` already enforce `script-src` without `'unsafe-inline'`, but the default `**` header still permits inline scripts.
- **Remediation:** Move any remaining inline scripts on storefront/payment pages into bundled Astro modules and drop `'unsafe-inline'` from the global `script-src` policy.

#### SEC-06 — Generate display `orderId` exclusively server-side for kiosk orders
- **Where:** `functions/src/orders/place_order.ts:94-95`
- **Risk:** Kiosk callers can pass any `orderId` matching `/^[A-Za-z0-9_-]{4,32}$/`, enabling deliberate display-number collisions across receipts and KDS tickets.
- **Remediation:** Ignore caller-supplied `orderId` for non-staff requests and always generate `serverOrderNumber()` on the server (or restrict override to `isStaff`).

#### SEC-07 — Shorten `kds_orders` PII retention TTL
- **Where:** `functions/src/orders/derived.ts:14`
- **Risk:** `KDS_MIRROR_TTL_MS` is 30 days, retaining customer phone numbers, addresses, and GPS coordinates in the staff-readable mirror well beyond the 7-day KDS lookback window (`KDS_LOOKBACK_MS`).
- **Remediation:** Reduce `KDS_MIRROR_TTL_MS` to 8–10 days (just above the 7-day KDS lookback).

#### SEC-08 — Harden fallback behavior when client IP is unavailable
- **Status:** Resolved. `clientIpFromRequest` now logs a structured warning (at most once per 10 minutes) when `x-forwarded-for`, `rawRequest.ip` and `socket.remoteAddress` are all empty, so a proxy misconfiguration that funnels every request into one shared rate-limit bucket shows up in Cloud Logging instead of silently throttling the shop.
- **Proof:** `functions/test/hardening_baseline.test.js` asserts the warning call site and that the documented fallbacks still return the same values.

#### SEC-09 — Keep the backfill mirror TTL aligned with the trigger
- **Where:** `functions/scripts/backfill-derived-views.js`, `functions/src/orders/derived.ts`
- **Risk:** `SEC-07` shortened the `kds_orders` PII retention to 10 days in the trigger, but the backfill script kept its own `KDS_MIRROR_TTL_MS = 30 days` literal. Any rerun would have written a 30-day `expireAt` back onto every mirrored order, undoing the retention fix for the whole 7-day window.
- **Resolution:** `KDS_MIRROR_TTL_MS` is exported from `derived.ts` and the script imports it, so the two cannot drift again.
- **Proof:** `functions/test/hardening_baseline.test.js` asserts the export, the import, and the absence of a local literal.

#### SEC-10 — Give the global PIN attempt ceiling headroom over the failure budget
- **Where:** `functions/src/auth/verify_staff.ts`
- **Risk:** `GLOBAL_PIN_ATTEMPT_MAX = GLOBAL_PIN_FAIL_MAX = 20` counted *every* PIN sign-in, so a shift-change rush of 20 successful logins in 15 minutes returned `Too many PIN login attempts` for the rest of the window. The failure budget (`checkAndRecordWindowFailure`) is the brute-force guard; the attempt counter only bounds scrypt volume.
- **Resolution:** The attempt ceiling is now `120` per 15 minutes (6× the failure budget) — unreachable by hand, still bounded for a flood.
- **Proof:** `functions/test/hardening_baseline.test.js` asserts the ceiling keeps at least 4× headroom over the failure budget and that the budget is still reserved before PIN verification.

---

## 3. Reliability Improvements Backlog

| ID | Priority | Status | Type | Area | Summary |
|---|---|---|---|---|---|
| **REL-01** | High | Partially resolved (index prod-gated) | Mixed | `firestore.indexes.json`, `functions/src/orders/kds.ts` | `getActiveOrders` filters in memory; the fixed 600-document scan cap silently dropped active orders. The cap is now a 2 000-document budget that logs when it truncates; the composite index remains production-gated |
| **REL-02** | High | Resolved | Code-only | `functions/src/payments/paymongo.ts`, `derived.ts` | Payment confirmation & `paidAfterCancel` Telegram alerts moved into `onOrderWritten` (`retry: true`) with atomic deduplication |
| **REL-03** | Medium | Resolved | Code-only | `app/src/staff/kds.ts`, `kds.css` | KDS tracks `snap.metadata.fromCache` and `online`/`offline` events and displays an offline/cached warning banner |
| **REL-04** | Medium | Resolved (idempotency & scheduled date) | Code-only | `functions/src/reporting/daily_report.ts` | Atomic daily-send guard uses the scheduler's scheduled PHT date on retries; 22:00 PHT cutoff remains pending ops confirmation |
| **REL-05** | Medium | Resolved | Code-only | `functions/src/reporting/manual_report.ts` | Added per-staff fixed-window rate limit (2/5m) and `HttpsError('internal', ...)` on unexpected failures |
| **REL-06** | Medium | Resolved | Code-only | `functions/src/orders/expire_unpaid.ts` | Added daily `expireStaleUnpaidOrders` sweep marking >24h `AWAITING_PAYMENT` orders as `PAYMENT_EXPIRED` + `Cancelled` |
| **REL-07** | Low | Resolved | Code-only | `app/src/pages/kiosk/gcash.astro` | Added debounced `visibilitychange` auto-verify when returning to the kiosk tab |
| **REL-08** | Low | Resolved | Code-only | `functions/src/orders/derived.ts` | Set explicit `timeoutSeconds: 45` on `onOrderWritten` (below `TELEGRAM_CLAIM_TTL_MS = 60s`) |
| **REL-09** | Medium | Resolved | Code-only | `app/src/staff/kds.ts` | KDS `updateStatus` shadowed the module `authHalted` flag, and metadata-only Firestore snapshots rebuilt the whole board |
| **REL-10** | Medium | Resolved | Code-only | `app/src/pages/kiosk/menu.astro`, `app/src/pages/kiosk/gcash.astro` | A second card tap threw `InvalidStateError` from `showModal()`, and a failed GCash retry kept the previous dead checkout session |

### Details

#### REL-01 — Add composite Firestore indexes for active KDS queries
- **Where:** `firestore.indexes.json`, `functions/src/orders/kds.ts`
- **Failure Mode:** `getActiveOrders` queries `orders` by `timestamp >= lookbackThreshold` and filters `status` and `isOrderVisibleInKds` in memory. The old `maxPages = 3` × `pageSize <= 200` ceiling capped a sweep at 600 documents, so on a busy week (completed, cancelled, and abandoned GCash orders all consume the window) an older still-active order fell off the board with no signal at all.
- **Code-only mitigation (done):** The page count is replaced by a `MAX_SCAN_DOCS = 2000` document budget with an explicit `truncated` flag and a `getActiveOrders stopped after scanning …` warning, so the ceiling is 3.3× higher and a real overflow is observable instead of silent. The response now also reports `scanned`.
- **Cost trade-off:** the deeper scan only costs more when the board cannot fill, because the loop still stops as soon as `maxDocs` visible orders are collected. In the worst case (a quiet board over a busy week) one call reads at most 2 000 documents across ≤11 single-field-index queries instead of 600 across 3 — and it now returns the complete board rather than a silent subset.
- **Remaining work (prod-gated):** Add composite indexes (`orders (status ASC, timestamp DESC)` or query `kds_orders` with `(status ASC, ts DESC)`) so Firestore does the filtering and the scan budget stops mattering.

#### REL-02 — Make payment confirmation & `paidAfterCancel` Telegram alerts durable
- **Where:** `functions/src/payments/paymongo.ts:212-222`, `functions/src/orders/derived.ts`
- **Failure Mode:** `markOrderPaidOnce` sends the Telegram payment confirmation (or cancelled-order refund warning) inside a `try/catch` that logs and swallows errors after the transaction commits. A transient Telegram outage permanently drops a `paidAfterCancel` refund alert.
- **Remediation:** Emit payment-confirmed and `paidAfterCancel` alerts from `onOrderWritten` (which has `retry: true`) with a dedicated deduplication marker in `order_notifications/{orderDocId}`.

#### REL-03 — Surface offline/cached state in KDS live listener
- **Where:** `app/src/staff/kds.ts:194-224`
- **Failure Mode:** Firestore's `onSnapshot` does not invoke its error callback on transient Wi-Fi drops; it serves cached data silently while the UI continues displaying a green live status.
- **Remediation:** Inspect `snap.metadata.fromCache` (with `includeMetadataChanges: true`) and listen to `window` `online`/`offline` events to show a clear "OFFLINE / CACHED" banner in the KDS header immediately when connectivity drops.

#### REL-04 — Guard daily reports against duplicate retries and keep the scheduled date
- **Where:** `functions/src/reporting/daily_report.ts`
- **Resolution:** `daily_reports_sent/{dateLabel}` provides an atomic idempotency guard; scheduled invocations derive the PHT date from `event.scheduleTime`, so a retry after midnight remains attached to the day the schedule fired. The existing 22:00 PHT cutoff remains unchanged pending operations confirmation.
- **Delivery guarantee:** Telegram has no idempotency key. If Telegram delivery succeeds while all Firestore writes remain unavailable, the sent marker cannot be persisted and a later retry after the lease TTL may duplicate a message; this is an unavoidable at-least-once trade-off, not a claim of exactly-once delivery.

#### REL-05 — Rate-limit `triggerManualReport` and standardize errors
- **Where:** `functions/src/reporting/manual_report.ts`
- **Failure Mode:** Repeated taps or retries can flood Telegram chats with identical reports; internal failures return `{ success: false }` instead of throwing `HttpsError`.
- **Remediation:** Add a short per-staff or global cooldown via `enforceFixedWindowRateLimit` (e.g., 2 requests / 5 min) and throw `HttpsError('internal', ...)` on unexpected failures.

#### REL-06 — Clean up stale abandoned `AWAITING_PAYMENT` orders
- **Where:** `functions/src/orders/place_order.ts`, `functions/src/payments/create_checkout.ts`
- **Failure Mode:** Abandoned GCash checkouts remain in `orders` indefinitely with `paymentStatus: 'AWAITING_PAYMENT'`, bloating storage and consuming `getActiveOrders` pagination pages.
- **Remediation:** Add a scheduled sweep (e.g., daily) that marks `AWAITING_PAYMENT` orders older than 24 hours as `PAYMENT_EXPIRED` (or deletes unreferenced abandoned drafts after a retention period).

#### REL-07 — Auto-verify GCash payment when returning to the kiosk tab
- **Where:** `app/src/pages/kiosk/gcash.astro:142-177`
- **Failure Mode:** Shoppers who complete payment in the PayMongo tab and switch back may wait passively without tapping `I HAVE PAID — VIEW RECEIPT`.
- **Remediation:** Trigger a single debounced `verify(pending)` check on `document` `visibilitychange` (when becoming visible and `sessionId` is set), while keeping the manual button available.

#### REL-08 — Align `onOrderWritten` timeout with `TELEGRAM_CLAIM_TTL_MS`
- **Where:** `functions/src/orders/derived.ts:51`, `functions/src/orders/send_notification.ts:276`
- **Failure Mode:** `TELEGRAM_CLAIM_TTL_MS` is 60s, matching the default Cloud Functions v2 timeout (60s). If a function hangs near 60s, a retry can reclaim the lock while the first invocation is still finishing.
- **Remediation:** Set explicit `timeoutSeconds: 45` on `onOrderWritten` (well below `TELEGRAM_CLAIM_TTL_MS = 60_000`) so a timed-out invocation cannot overlap with a reclaimed retry.

#### REL-09 — Keep the KDS auth halt authoritative and skip no-op board rebuilds
- **Where:** `app/src/staff/kds.ts`
- **Failure Modes:**
  1. `updateStatus` declared a local `let authHalted = false`, shadowing the module flag. After `haltOnAuthError()` the `finally` block read the shadow and re-rendered the board, and a status tap after an auth halt still fired a callable that was guaranteed to fail.
  2. `onSnapshot` runs with `includeMetadataChanges: true`, so a cache/server flip fired `publish()` → `renderAll()` and rebuilt the HTML for every card even though no document changed, resetting scroll and burning the kitchen tablet's CPU.
- **Resolution:** The shadow is gone and `updateStatus` returns early once `authHalted` is set; the snapshot handler compares the mapped order list against the previous signature and, when nothing changed, only repaints the feed indicator and banner.
- **Proof:** `test/site/staff.test.mjs` asserts the early return, that exactly one `authHalted = false` declaration exists, and the unchanged-snapshot short circuit.

#### REL-10 — Make the kiosk item sheet and GCash retry recoverable
- **Where:** `app/src/pages/kiosk/menu.astro`, `app/src/pages/kiosk/gcash.astro`
- **Failure Modes:**
  1. `openSheet()` called `sheet.showModal()` with no guard. A second card tap while a sheet was open threw `InvalidStateError`, which surfaced as an unhandled rejection while the dialog had already been re-filled for the other item.
  2. `start()` reused the module-level `checkoutUrl`/`sessionId` and never cleared the "Checkout session is not ready yet" message. After a failed `createCheckoutSession`, a retry could leave the dead session id in place, and a retry that succeeded left the stale error on screen so "I HAVE PAID" looked broken.
- **Resolution:** `openSheet` returns early while a sheet is open (keeping the first one and its `close` promise intact); `start()` resets `checkoutUrl`/`sessionId`/the verify error before calling the provider and clears the error again once a session arrives.
- **Proof:** `test/site/staff.test.mjs` asserts the sheet guard and both GCash resets.

---

## 4. Performance Improvements Backlog

| ID | Priority | Status | Type | Area | Summary |
|---|---|---|---|---|---|
| **PERF-01** | High | Partially resolved (index prod-gated) | Mixed | `functions/src/orders/kds.ts`, `firestore.indexes.json` | Indexed active-order query still pending; the scan ceiling is now a logged 2 000-document budget instead of a silent 600-document cap |
| **PERF-02** | High | Deferred | Code-only | `functions/src/index.ts` | Split codebases / lazy-load handlers when dependencies grow (currently only `firebase-admin` + `firebase-functions`) |
| **PERF-03** | Medium | Resolved | Code-only | `app/src/staff/dashboard.ts`, `functions/src/orders/kds.ts`, `functions/src/orders/place_order.ts` | Dashboard summary query selects persisted `itemsCount`, excluding full item arrays, coordinates, and phone/address fields |
| **PERF-04** | Medium | Pending (prod-gated) | Prod-gated | `functions/src/auth/verify_staff.ts` | Peppered `pinLookupHash` requires new `PIN_PEPPER_SECRET` in Secret Manager + backfill |
| **PERF-05** | Medium | Deferred | Code-only | `functions/src/reporting/lifetime_report.ts` | All-time report reads every `dailyStats` doc; add yearly rollups once `dailyStats` exceeds ~500 docs |
| **PERF-06** | Low | Resolved | Code-only | `app/src/staff/reports.ts` | `fitTitle` resize listener now throttled with `requestAnimationFrame` + `cancelAnimationFrame` on dispose |
| **PERF-07** | Low | Deferred | Code-only | `firebase.json:59-64` | Static images use 1-day `max-age=86400`; hashed assets can use immutable caching |
| **PERF-08** | Low | Pending (prod-gated) | Prod-gated | `functions/src/index.ts`, customer callables | Evaluate `minInstances: 1` for `placeOrder` / `createCheckoutSession` from Cloud Monitoring p95 telemetry |

### Details

#### PERF-01 — Replace in-memory `getActiveOrders` filtering with indexed queries
- **Where:** `functions/src/orders/kds.ts:91-118`, `firestore.indexes.json`
- **Bottleneck:** Each fallback poll reads 50–600 `orders` documents and discards completed/cancelled/unpaid docs in Node.
- **Improvement:** Query `kds_orders` (already filtered by `isOrderVisibleInKds`) with a composite index on `(status, ts DESC)` for active-only calls.

#### PERF-02 — Lazy-load function handlers to reduce cold-start latency
- **Where:** `functions/src/index.ts`
- **Bottleneck:** Importing all 13 function modules at top-level forces every cold instance (e.g., `placeOrder`) to parse and initialize unrelated modules (reporting, auth, Telegram, PayMongo).
- **Improvement:** Defer heavy module imports inside handler bodies (or split codebases/entrypoints) so each function only loads its own dependency tree on cold start.

#### PERF-03 — Slim down dashboard recent-orders payload
- **Where:** `app/src/staff/dashboard.ts`, `functions/src/orders/kds.ts`, `functions/src/orders/place_order.ts`, `app/src/kiosk/order.ts`
- **Resolution:** Dashboard still requests `summaryOnly`, and the callable now selects `itemsCount` instead of `items`. The server and client order payloads persist this aggregate quantity on new orders; the summary response omits full item arrays and customer phone/address/GPS fields. The ordinary KDS response retains full line items.

#### PERF-04 — Make staff PIN lookup `O(1)` while preserving `scrypt` verification
- **Where:** `functions/src/auth/verify_staff.ts:27-44, 102-115`
- **Bottleneck:** PIN login scans up to 50 staff accounts and runs `scrypt` in batches of 2 until matched. As staff count grows, invalid PINs consume significant CPU and increase latency.
- **Improvement:** Store a server-peppered `pinLookupHash = HMAC-SHA256(PIN_PEPPER_SECRET, pin)` on `staff_accounts` to narrow lookup to 1 document, then verify the candidate's `scrypt` `pinHash` as the authoritative check.

#### PERF-05 — Add yearly rollups for multi-year lifetime reports
- **Where:** `functions/src/reporting/lifetime_report.ts:41-47`
- **Bottleneck:** All-time queries read every `dailyStats/{YYYY-MM-DD}` doc. Fine in year 1 (~365 docs), but grows linearly over multi-year operation.
- **Improvement:** Introduce `monthlyStats/{YYYY-MM}` or `yearlyStats/{YYYY}` rollups when `dailyStats` exceeds ~500 documents.

#### PERF-06 — Throttle `fitTitle` resize handler in `app/src/staff/reports.ts`
- **Where:** `app/src/staff/reports.ts:47-58, 99`
- **Bottleneck:** `addEventListener('resize', fitTitle)` fires synchronously on every resize event, triggering forced layout reflow via `style.transform = ''` + `getBoundingClientRect()`.
- **Improvement:** Wrap in `requestAnimationFrame` with `cancelAnimationFrame` on dispose (matching `app/src/kiosk/fit.ts` and `app/src/staff/dashboard.ts`).

#### PERF-07 — Long-term immutable caching for versioned image assets
- **Where:** `firebase.json:59-64`
- **Bottleneck:** Public images use `max-age=86400` (24 hours), causing unnecessary conditional revalidations for returning kiosk and storefront visitors.
- **Improvement:** Route menu/storefront images through Astro's hashed asset pipeline (`/_astro/**`, `max-age=31536000, immutable`) or extend `max-age` on immutable versioned filenames.

#### PERF-08 — Measure and tune Cloud Functions cold-start latency
- **Where:** `functions/src/index.ts`, `functions/src/orders/place_order.ts`, `functions/src/payments/create_checkout.ts`
- **Bottleneck:** `minInstances` defaults to `0`; first customer order after an idle period incurs a cold start.
- **Improvement:** Track p95 latency in Cloud Monitoring for `placeOrder` and `createCheckoutSession`. If cold starts exceed target checkout UX budgets, evaluate `minInstances: 1` for those two endpoints (after applying PERF-02).

---

## 5. Recommended Execution Roadmap

### Phase 1 — Code-Only Quick Wins (No Production Rollout Coordination Needed)
1. **REL-02:** Move payment-confirmed / `paidAfterCancel` Telegram alerts into `onOrderWritten` (`retry: true`).
2. **SEC-06:** Enforce server-only `orderId` generation for non-staff `placeOrder` calls.
3. **SEC-07 & REL-08:** Reduce `KDS_MIRROR_TTL_MS` to 10 days and set `timeoutSeconds: 45` on `onOrderWritten`.
4. **REL-03:** Surface `fromCache` and `online`/`offline` connectivity state in `app/src/staff/kds.ts`.
5. **REL-05:** Add rate limiting and `HttpsError` handling to `triggerManualReport`.
6. **PERF-06:** Throttle `fitTitle` with `requestAnimationFrame` in `app/src/staff/reports.ts`.
7. **REL-07:** Add `visibilitychange` auto-verify in `app/src/pages/kiosk/gcash.astro`.
8. **SEC-05:** Bundle remaining inline scripts on storefront/payment pages and remove `'unsafe-inline'` from global `script-src`.

### Phase 2 — Production-Gated Security & Index Rollouts (Requires Explicit Deployment Approval)
1. **SEC-01 & SEC-02:** Remove legacy direct-write fallback in `app/src/kiosk/order.ts`, lock down `orders/{orderId}` (`allow read, write: if false`), and remove unused `pasugo_*` / `riders` blocks from `firestore.rules`.
2. **REL-01 & PERF-01:** Deploy composite Firestore indexes in `firestore.indexes.json` and switch `getActiveOrders` to indexed active-order queries.
3. **SEC-04:** Enable `enforceAppCheck: true` on public callables after verifying App Check token coverage in Firebase Console.

### Phase 3 — Scale & Operational Maturity
1. **PERF-02:** Split/lazy-load Cloud Function imports to cut cold-start times.
2. **REL-04 & REL-06:** Add daily report idempotency guard and scheduled cleanup for abandoned `AWAITING_PAYMENT` orders.
3. **PERF-03, PERF-04, PERF-05, PERF-07, PERF-08:** Slim dashboard payloads, add `O(1)` peppered PIN lookup if staff grows, add yearly rollups for multi-year stats, and tune image caching / `minInstances` from real telemetry.

---

## 6. Baseline Verification Checklist

Run these checks before and after any work against this baseline:

```bash
# Full local CI gate (functions build/lint/test/audit, emulator rules + derived views, site check/lint/build/test/audit)
npm run ci

# Verify local firestore.rules matches production (read-only)
cd functions && npm run check:rules-drift
```

Any PR addressing items from this baseline should update the status of resolved items here and attach evidence under `docs/evidence/`.
