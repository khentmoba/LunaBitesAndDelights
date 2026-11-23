# Performance, reliability & security pass — 2026-11-24 (b)

Scope: a full read of `functions/src/**`, `functions/scripts/**`, `app/src/**`, `firebase.json`,
`firestore.rules`, `firestore.indexes.json`, and `storage.rules` looking for new defects after the
`docs/reliability-performance-security-baseline.md` items already landed. Every fix below is
code-only: no `firestore.rules`, no `firestore.indexes.json`, no secret, no deployment.

## Found and fixed

| # | Class | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | Availability / anti-lockout | `functions/src/auth/verify_staff.ts` | The global PIN **attempt** budget was `GLOBAL_PIN_ATTEMPT_MAX = GLOBAL_PIN_FAIL_MAX = 20`, and `enforceFixedWindowRateLimit` counts *every* attempt, including successful ones. Twenty ordinary sign-ins in 15 minutes (shift change on a shared tablet) returned `Too many PIN login attempts` to the whole team for the rest of the window. | Failure budget unchanged at 20/15 min (`checkAndRecordWindowFailure` is the brute-force guard); the attempt ceiling is now 120/15 min, which bounds scrypt volume without being reachable by hand. |
| 2 | Security / PII retention | `functions/scripts/backfill-derived-views.js` | The script kept its own `KDS_MIRROR_TTL_MS = 30 days` literal after `SEC-07` shortened the trigger to 10 days, so any backfill rerun wrote a 30-day `expireAt` onto every mirrored order and undid the retention fix. | `KDS_MIRROR_TTL_MS` is exported from `functions/src/orders/derived.ts` and imported by the script. The test asserts the import and forbids a local literal. |
| 3 | Reliability / silent data loss | `functions/src/orders/kds.ts` | `getActiveOrders` filtered closed and unpaid orders in memory inside a fixed `maxPages = 3` loop, so a sweep stopped after 600 documents. On a busy week an older still-active order fell off the kitchen board with no signal. | Fixed page count replaced with a `MAX_SCAN_DOCS = 2000` document budget and an explicit loop that paginates until the limit is filled or the query is exhausted. Hitting the budget now logs `getActiveOrders stopped after scanning …` and returns `truncated`/`scanned` instead of failing silently. |
| 4 | Correctness / shadowed state | `app/src/staff/kds.ts` | `updateStatus` declared `let authHalted = false`, shadowing the module flag. After an auth halt the `finally` re-rendered the board, and a status tap still fired a callable guaranteed to fail. | Shadow removed; `updateStatus` returns early when `authHalted` is set. |
| 5 | Performance / unnecessary re-render | `app/src/staff/kds.ts` | The live listener uses `includeMetadataChanges: true`, so every cache↔server flip ran `publish()` → `renderAll()` and rebuilt the HTML for all 200 cards although no document changed (scroll reset, CPU burn on the kitchen tablet). | The snapshot handler compares the mapped order list with the previous signature; when nothing changed it repaints only the feed indicator and banner. |
| 6 | Bug / dialog re-entrancy | `app/src/pages/kiosk/menu.astro` | A second card tap while the item sheet was open called `showModal()` on an open dialog → `InvalidStateError` and an unhandled rejection, with the dialog already re-filled for the other item. | `openSheet` returns early while a sheet is open, keeping the first sheet and its `close` promise intact. |
| 7 | Bug / stale session state | `app/src/pages/kiosk/gcash.astro` | `start()` reused the module `checkoutUrl`/`sessionId` and never cleared the "Checkout session is not ready yet" message, so a retry kept a dead session id and a successful retry left a stale error that made "I HAVE PAID" look broken. | `start()` resets `checkoutUrl`, `sessionId` and the verify error before calling the provider, and clears the error again once a session arrives. |
| 8 | Observability / security | `functions/src/util/security.ts` | `clientIpFromRequest` returned `''` when no client IP was derivable, so a proxy misconfiguration silently funnelled every caller into one shared rate-limit bucket (`SEC-08` remediation). | Logs a structured warning at most once per 10 minutes; the documented fallbacks and their return values are unchanged. |

## Audited and deliberately left alone

- **`orders/{orderId}` client-create rule and the legacy `pasugo_*` / `riders` blocks.** Real
  findings, but `firestore.rules` must stay byte-identical to production until someone deploys it
  (`docs/DEPLOYMENT_STATE.md`). Tracked as `SEC-01`/`SEC-02`.
- **Composite KDS index.** `REL-01`/`PERF-01` need `firestore.indexes.json` plus a production
  rollout, so only the code-only mitigation above landed.
- **App Check enforcement on public callables.** Needs Firebase Console metrics and an explicit
  go-ahead (`SEC-04`).
- **`PAYMENT_FAILED` orders are never swept.** `expireStaleUnpaidOrders` only matches
  `AWAITING_PAYMENT`, so failed GCash attempts keep `status: 'Pending'` forever. They are hidden
  from the KDS and excluded from revenue, and cancelling them changes order semantics, so this
  stays a product decision rather than a silent behaviour change.
- **Price parity.** `test/site/price-parity.test.mjs` (part of `npm run test:site`) already
  walks every `app/src/data/menu.ts` item through the cart's own pricing — the base price, each
  single-select variant, and every reachable `maxSelect` flavour combination — and asserts each
  one is an allowed price in `createCheckoutSession`'s `MENU_PRICES`/`VARIANT_PRICES`. It passes
  unchanged, including the ₱0 flavour variants on the multi-select fries and `3 for ₱100 Coolers`.
- **`pasugo_errands` `allow list: if true`** exposes `pinHash` and phone numbers to anonymous
  callers. Already tracked as `SEC-02`; unusable from this app (no client code references those
  collections).

## Verification

```bash
npm --prefix functions run build     # tsc, clean
npm --prefix functions run lint      # ESLint, no issues
cd functions && npm test             # 98 unit tests, 0 fail (2 new)
cd functions && npm run test:rules   # 25 Firestore rules emulator tests, 0 fail
cd functions && npm run test:derived # 4 Functions+Firestore emulator tests, 0 fail
cd app && npm run check              # astro check, 0 errors
cd app && npm run lint               # ESLint
cd app && npm run build              # 17 pages built
npm run test:site                    # 79 storefront/kiosk/staff tests, 0 fail (2 new)
npm run ci                           # full gate; output in docs/evidence/ci-local.txt
```

New regression tests:

- `functions/test/hardening_baseline.test.js` — "kiosk board scan budget, staff PIN budget and
  mirror TTL stay inside their limits" and "clientIpFromRequest reports a missing client IP
  instead of silently sharing one bucket".
- `test/site/staff.test.mjs` — "kds skips the board rebuild on metadata-only snapshots and stops
  after an auth halt" and "kiosk menu sheet and GCash page recover from a second tap and a failed
  retry".

## Review loop

Run in-thread on `pi` / `deepseek-v4-1-flash-1017` (`thinking: max`) instead of a reviewer subagent,
per the "no subagents, use deepseek by mistral on pi at max effort for the loop" instruction. Base
`5d3ce50a67edf167c1ccc337270393aabc5ab622`, 3 rounds, one triage pass per round.

| id | class | severity | triage | outcome |
|---|---|---|---|---|
| D1 | Resource cost: deeper scan in `getActiveOrders` | nit | yes | Documented: the loop still stops as soon as `maxDocs` visible orders exist, so the deeper path only runs when the board cannot fill. Recorded as a cost trade-off note under `REL-01`. |
| D2 | Testability: `resetMissingClientIpWarning` exported from a production module | nit | yes | Declined: `functions/src/reporting/daily_stats.ts` already exports `resetBackfillCache()` for the same reason. |
| D3 | Test style: new tests assert source shape, not behavior | nit | yes | Declined: JSDOM has no `HTMLDialogElement.showModal`, and there is no emulator harness for `getActiveOrders`/`verifyStaff`; both target files already used this style. |
| D4 | Correctness: `openSheet` guard could swallow a `?pick=` restore sheet | nit | yes | Verified non-issue: `applyPicks` awaits each sheet's `close` before opening the next, and `close()` clears `open` synchronously. |
| D5 | Correctness: does the snapshot short circuit skip `publish()` bookkeeping? | nit | yes | Verified: `checked` pruning, `checkNewOrders` (0 arrivals when ids are unchanged), `loading` and `renderAll` are all no-ops on an unchanged snapshot, and the first snapshot always differs from the empty signature. |

No blocker or should stayed open, so rounds 2 and 3 were re-reads of the same diff (callers,
`onCall` config, built output, test wiring) with no new findings. Step back at round 3: keep the
approach — every change is a guard, a reused constant, or a bounded loop; no new abstraction,
cache, or option was added.
