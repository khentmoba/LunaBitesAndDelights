# Reliability, security & bug hardening — 2026-11-24

## Summary of findings fixed

| Area | Finding | Fix | Regression proof |
| --- | --- | --- | --- |
| Payments (`functions/src/payments/create_checkout.ts`) | `createCheckoutSession` and `persistCheckoutSession` only checked `Cancelled` and `PAID`, allowing `Completed` or `PAYMENT_EXPIRED` orders to mint fresh PayMongo checkout sessions. Also duplicated eligibility checks and did not log an orphaned PayMongo session if `persistCheckoutSession` rejected after the provider POST. | Extracted shared `assertOrderCheckoutEligible(orderData)` rejecting `Completed` and `PAYMENT_EXPIRED` in addition to non-GCash, `Cancelled`, and `PAID`. Used it in both pre-check and `persistCheckoutSession`, and added a warning log naming the PayMongo `sessionId` if `persistCheckoutSession` rejects. | `functions/test/payment_reconciliation.test.js`: `assertOrderCheckoutEligible and persistCheckoutSession reject Completed and PAYMENT_EXPIRED orders` (covers `Completed`, `Cancelled`, `PAYMENT_EXPIRED`, plus valid `AWAITING_PAYMENT`/`PAYMENT_FAILED`). |
| Staff auth (`functions/src/auth/verify_staff.ts`) | PIN login minted custom tokens with `staff_${accountName}` (from `data.username`) instead of `staff_${matchedUser.id}` (the `staff_accounts` document ID), and skipped updating `lastLoginAt`. When `data.username` differed in case or value from `doc.id`, `updateStaffPin` (`uid.replace(/^staff_/, '')`) could fail to resolve the account document. | Added exported `staffAuthUid(docId)` (`staff_${docId}`), minted PIN-login tokens from `matchedUser.id`, and updated `lastLoginAt` fail-open on PIN login to match password login. | `functions/test/staff_auth.test.js`: `staffAuthUid derives the Firebase Auth UID from the staff_accounts doc id` (`staffAuthUid('admin') === 'staff_admin'`, `staffAuthUid('staff1') === 'staff_staff1'`). |
| Staff PWA SW (`app/public/staff/sw.js`) | `fetch` cached any `status === 200` response, including redirected 200 responses (`res.redirected === true`). Serving a cached redirected response to an offline `mode: 'navigate'` request causes browsers to fail with a Fetch redirect error, and keeping `CACHE = 'luna-staff-v3'` would leave previously poisoned entries on installed tablets. | Added `isCacheableResponse(res)` (`res.status === 200 && !res.redirected`) across all three cache paths and bumped `CACHE` to `luna-staff-v4` so `activate` purges `luna-staff-v3`. | `test/site/staff.test.mjs`: `staff service worker serves immutable assets cache-first and prunes navigation cache entries` asserts `activate` deletes `luna-staff-v3` and redirected 200 navigation responses are never cached. |
| KDS navigation (`app/src/staff/kds.ts`) | Back button called `history.back()` unconditionally, which is a no-op when opened in a fresh tab or standalone PWA without prior history. | Fall back to `go('/staff/dashboard')` when `history.length <= 1`. | `app/src/staff/kds.ts` + Astro type check & site build. |
| Kiosk map (`app/src/pages/kiosk/map.astro`) | Startup auto-locate did not hold `locating`/`locateSeq`, allowing a concurrent `[data-locate]` tap to fire a duplicate geolocation request or clobber state. | Guarded startup auto-locate with `locating`, `locateSeq`, and `try/finally` reset so only one geolocation request is in flight and user drag/search/confirm supersedes it cleanly. | `app/src/pages/kiosk/map.astro` + Astro type check & site build. |
| Kiosk GCash (`app/src/kiosk/order.ts`, `app/src/pages/kiosk/gcash.astro`) | `verifyCheckoutPayment` returning `PAYMENT_EXPIRED` fell through to the generic "Payment has not cleared yet" prompt instead of telling the shopper the session expired. | Exported `verifyPaymentErrorMessage(paymentStatus)` in `app/src/kiosk/order.ts` with an explicit `PAYMENT_EXPIRED` message and wired `gcash.astro` to it. | `test/site/kiosk.test.mjs`: `verifyPaymentErrorMessage maps failed, expired, and pending payment statuses`. |
| Kiosk label fitter (`app/src/kiosk/fit.ts`) | `fitLabels` computed `k = room / width` even when `room <= 0` or `NaN` (e.g. hidden container or non-px padding), writing `0px` or `NaNpx` inline font sizes. | Guarded with `if (!(room > 0) || width <= room || width === 0) continue;`. | `test/site/kiosk.test.mjs`: `fitLabels does not shrink text to 0px or NaNpx when parent width is zero or padding is NaN`. |

## Concrete verification outputs

### Targeted unit test execution

```text
$ node --test test/site/staff.test.mjs test/site/kiosk.test.mjs
✔ fitLabels does not shrink text to 0px or NaNpx when parent width is zero or padding is NaN
✔ verifyPaymentErrorMessage maps failed, expired, and pending payment statuses
✔ staff service worker serves immutable assets cache-first and prunes navigation cache entries
ℹ tests 43 | pass 43 | fail 0

$ node --test functions/test/payment_reconciliation.test.js functions/test/staff_auth.test.js
✔ assertOrderCheckoutEligible and persistCheckoutSession reject Completed and PAYMENT_EXPIRED orders
✔ staffAuthUid derives the Firebase Auth UID from the staff_accounts doc id
ℹ tests 50 | pass 50 | fail 0
```

### Full local CI (`npm run ci`)

All 12 executed steps passed (6 skipped: up-to-date `npm ci` and PR-context-only proof gate). Full summary recorded in [`ci-local.txt`](ci-local.txt):

- `functions`: TypeScript build, lint (promise checks), unit tests, outdated deps report, runtime audit.
- `rules`: Firestore rules emulator tests, derived views (Functions + Firestore emulators) tests.
- `site`: Astro type check, lint (promise checks), storefront build, runtime audit, storefront tests.

## Out of scope

No changes were made to `firestore.rules`, production App Check settings, Secret Manager bindings, or deployed Firestore indexes.
