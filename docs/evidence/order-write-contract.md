# Order writes vs. production Firestore rules

Deploying `firestore.rules` on 2026-11-14 started enforcing three checks on order creates that production had skipped. Unless the writer has a `staff`/`admin` role claim, `status` must be `Pending`, `paymentStatus` must be `NOT PAID` or `AWAITING_PAYMENT`, and `entryType` must be `Kiosk`.

## Audit

| Writer | Path | Result |
|---|---|---|
| Kiosk customer, cash | `checkout_page.dart` → `OrderService.saveOrder` | `Kiosk` / `NOT PAID` / `Pending`: allowed |
| Kiosk customer, GCash | same | `Kiosk` / `AWAITING_PAYMENT` / `Pending`: allowed |
| Staff POS | same | `Staff` / `PAID`: allowed only with the role claim `verifyStaff` puts on the custom token |
| Cloud Functions (KDS, PayMongo checkout + webhook, notifications) | Admin SDK | rules don't apply |

## Gaps fixed

- `Session` treated any signed-in Firebase user as staff (`displayName ?? 'Staff'`). That user's orders would go out as `Staff`/`PAID` and be rejected. Staff mode now needs a `staff_` uid and a `staff`/`admin` claim; without the claim the user drops out of staff mode.
- Staff checkout skipped name validation, and the rules reject names over 100 characters. Nothing capped cart lines, and the rules reject more than 50. Checkout now blocks both with a clear message instead of a failed save.
- Status values live in `OrderPolicy.statusesFor`, so the tests run the same code as checkout.

## Guards

- `test/order_service_test.dart` writes each checkout combination (kiosk/staff × Cash/GCash) through the real `OrderService.saveOrder` and compares it to `functions/test/fixtures/checkout/*.json`.
- `functions/test/firestore-rules.test.js` runs every fixture through `firestore.rules` in the emulator. Kiosk fixtures save signed out, signed in, and as staff. Staff fixtures save with staff/admin claims and fail without them. The 100-character and 50-line limits are checked too.
- Mutation check: making kiosk GCash send `PAID` fails two Dart tests (`order-write-contract/mutation-gcash-paid.txt`).

## Local checks

| Job | Result |
|---|---|
| flutter analyze + baseline | 0 issues |
| format (changed files) | clean |
| flutter test | 59 pass |
| rules (emulator, JDK 21) | 19 pass |
| site | pass |
| functions build | pass |
| flutter build web | not run locally; CI runs it |
