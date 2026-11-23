# Coding Standards

Review-time rules for changes in `app/`, `functions/`, `firestore.rules`, and `firebase.json`. Mechanical rules live in ESLint and `npm run ci`; this file covers judgement calls.

## Backend (`functions/src/`)

- **Lease & retry semantics (`retry: true` triggers):**
  - When a Firestore lease claim finds an active in-flight marker (`status === 'sending'` before TTL expiry), throw/reject so Cloud Functions retries the event. Returning a resolved promise marks the delivery complete and permanently drops retries if the first invocation crashes.
  - Isolate retry counters by trigger source (e.g., `attempts` for Eventarc/callable retries vs. `reconcileAttempts` for scheduled reconcilers) so one path cannot starve the other.
  - After an external side effect succeeds (Telegram send, PayMongo state transition), persist completion state atomically (`photoSent`, canonical `migrate_to_chat_id`, `paymentNotifSent`). Never leave a reclaimable `sending` lease after a side effect has already fired.
- **Server-authoritative pricing & state:**
  - Never trust client-supplied prices, totals, item lists, timestamps, or status fields in payment or notification handlers. Always read the persisted `orders/{id}` document and re-price against `MENU_PRICES` and `VARIANT_PRICES`.
- **Secrets & configuration (`functions/src/secrets.ts`):**
  - Every required production secret must be declared with `defineSecret` in `functions/src/secrets.ts` and bound in the function's `secrets: [...]` option.
  - Never add a fail-closed gate on an unprovisioned `process.env.*` secret unless `docs/DEPLOYMENT_STATE.md` confirms it is provisioned in Secret Manager or an API-verification fallback remains active.
- **Proxy IPs, rate limits & HTTP statuses:**
  - Read the rightmost entry of `x-forwarded-for` (`clientIpFromRequest`), which Google Cloud load balancers append.
  - Only map `HttpsError('resource-exhausted')` to HTTP `429`. Unexpected Firestore or internal errors in webhooks must return `500` so the caller retries.
- **Firestore transaction retry safety:**
  - Return the outcome directly from `db.runTransaction(...)` (or reset every outer accumulator at the top of the callback) so a contention retry cannot leak state from a lost attempt.
  - Derive caller responses and operational logs from the post-transaction result rather than pre-transaction document snapshots.
- **Module-level caches & operational messages:**
  - Any module-level cache in Cloud Functions must define a bounded TTL or invalidation condition.
  - Error messages and logs must only name scripts or runbooks that exist in `package.json`, `tool/`, or `functions/scripts/`.

## Frontend (`app/src/`, `app/public/`)

- **Async concurrency & lifecycle:**
  - Guard overlapping async UI fetches (`dashboard.ts`, `reports.ts`, `kds.ts`) with a monotonic request sequence (`fetchSeq`) and check `disposed` after every `await`.
  - Clean up every `onSnapshot` listener, `setInterval`, `setTimeout`, and `requestAnimationFrame` on page teardown and on unrecoverable auth errors (`permission-denied`, `unauthenticated`).
  - For incremental polling/snapshot updates, re-render only the target subtree (`renderBoard`) rather than calling `renderAll()` and clobbering active inputs, modals, or loading states.
- **CSP & DOM safety:**
  - `/kiosk/**`, `/staff/**`, and `/payment/**` enforce `script-src 'self'` without `'unsafe-inline'`. Do not add `<script is:inline>`, inline event attributes (`onclick=`, `onload=`), or `javascript:` URLs on those routes.
  - Every external origin added to an `<iframe>`, `<script>`, `<link>`, `<img src>`, or `fetch()` call must be permitted by the matching `Content-Security-Policy` directive in `firebase.json`. When adding or swapping a third-party browser SDK (e.g., Google Maps, reCAPTCHA), verify its runtime sub-resource origins (stylesheets, fonts, workers) against CSP too, not just static HTML tags.
  - Escape all untrusted strings interpolated into HTML via `esc()` (`app/src/staff/ui.ts`) or assign via `textContent`.
  - Every interactive `/kiosk/` page must wire `watchInactivity()` (`app/src/kiosk/inactivity.ts`).

## Tests (`functions/test/`, `test/site/`)

- **Behavior over source-text regexes:** Regression tests for bug fixes must exercise the compiled/exported function or an extracted pure helper rather than `assert.match()` over `.ts` source text. Reserve source/HTML scanning for static structural invariants (CSP, TTL, manifest parity).

## Firestore Rules & Indexes (`firestore.rules`, `firestore.indexes.json`)

- **Rules-drift constraint:** `firestore.rules` is checked against live production by `.github/workflows/rules-drift.yml` and `functions/scripts/check-firestore-rules-drift.js`. Do not edit `firestore.rules` without updating `functions/test/emulator/firestore-rules.test.js` and noting the required production rules deploy (see `docs/DEPLOYMENT_STATE.md`).
- **TTL parity:** Every collection that writes an `expireAt` timestamp in `functions/src/` must have a matching `ttl: true` `fieldOverrides` entry in `firestore.indexes.json`.
