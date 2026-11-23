# Payment state and KDS feed fixes (2026-11-24)

Three defects found by reading the money path and the kitchen board. Each one
is a state bug, not a crash: the app keeps running and quietly shows or stores
the wrong thing.

## 1. A superseded checkout session could fail a live order

`createCheckoutSession` reuses an order while the customer is on the GCash page,
but a retry replaces the session and appends the new one to
`checkoutSessionIds`. The `checkout_session.payment.failed` webhook and
`verifyCheckoutPayment` fetched the session named in the event, then fell back
to `hasMatchingCheckoutSession`, which only asks "is this session anywhere in
the order's history". A late failure for the *replaced* session therefore wrote
`paymentStatus: 'PAYMENT_FAILED'` over the order the customer was still paying,
and the kiosk showed a decline for a payment that had never been attempted.

Fix, in `functions/src/payments/paymongo.ts`:

- `isLiveCheckoutSession()` compares against `checkoutSessionId` (the session
  the kiosk last handed over) and only uses the history when an order predates
  that field.
- `shouldMarkPaymentFailed()` refuses when the status is already terminal
  (`PAID`, `PAYMENT_EXPIRED`) and otherwise requires the live session.
- `markOrderPaymentFailed()` now runs that predicate inside its transaction.
  The webhook logs "ignored" instead of claiming a failure it did not write,
  and `verifyCheckoutPayment` returns the status the order actually has.

## 2. The kitchen board froze when the live feed fell back to polling

`publish()` merges `mergeKdsOrders(live ?? [], polled)`, and live entries win.
`fallBackToPolling()` cleared `liveSignature` but kept `live`, so after a
listener error every ticket already on screen stayed at the status it had when
the listener died: polling kept running, `getActiveOrders` kept returning fresh
rows, and the merge threw them away. A cook marking an order Ready on a phone
never moved the tablet.

Fix, in `app/src/staff/kds.ts`: the fallback drops the retained snapshot, so the
board is driven by `getActiveOrders` until a live snapshot arrives again.

## 3. The KDS header and banner were rebuilt on every snapshot

`renderAll()` ran on every poll and every snapshot, re-creating the SYNC,
SOUND, POS, EXIT and RETRY buttons from identical markup. That drops keyboard
focus on a device that is often driven by a switch or keyboard, and a tap that
lands while the listener fires hits a node that is being replaced.

Fix: `renderBar()` and `renderBanner()` keep the last markup they wrote and skip
the write when nothing changed, matching the per-column cache already used for
the board itself.

## Proof

### Unit and site tests

```
functions: tests 33  pass 33  fail 0    (node --test test/payment_reconciliation.test.js)
site:      tests 17  pass 17  fail 0    (node --test test/site/staff.test.mjs)
```

The four new `payment_reconciliation` cases pin the matrix: live session,
superseded session, legacy order with no primary id, terminal statuses, and the
no-session call path. The new `staff` case pins the fallback invariant and the
markup cache.

### The tests fail without the fixes

Removing `live = null;` and both `html === …Html` guards from
`app/src/staff/kds.ts` turns the new site test red:

```
✖ kds hands the board to polling and keeps header buttons alive when nothing changed
  AssertionError [ERR_ASSERTION]: the fallback must drop the retained live snapshot before polling takes over
```

### Rendered board, real emulator

`tool/parity/staff_e2e.mjs` against the auth, firestore and functions emulators
(`errors: []`, all steps green):

| step | result |
| --- | --- |
| wrong PIN | `Invalid PIN. Please try again.`, still on login |
| right PIN | KDS in 624 ms, claim `role: staff` |
| START PREPARING | `orders.status` and `kds_orders.status` both `Preparing` |
| MARK AS READY | both `Ready`, next action `COMPLETE & DISPATCH` |
| 1440 board | [ts-staff-e2e-kds-ready-1440.png](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/ts-staff-e2e-kds-ready-1440.png?raw=true) |
| 390 board | tabbed layout, READY tab, one card: [ts-staff-e2e-kds-ready-390.png](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/ts-staff-e2e-kds-ready-390.png?raw=true) |
| dashboard | `Today's Sales ₱263 · Orders 1 · Avg ₱263 · Items sold 3` |
| logout | auth row cleared, kiosk staff link hidden |

Full step log: [ts-staff-e2e.json](ts-staff-e2e.json).

### Deliberately not changed

`firestore.rules` direct-write lockdown, App Check enforcement, the composite
index deploy and the webhook secret rotation still need a production rollout
window; they are tracked in [DEPLOYMENT_STATE.md](../DEPLOYMENT_STATE.md).
