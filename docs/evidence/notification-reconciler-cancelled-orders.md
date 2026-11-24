# Notification reconciler re-announced cancelled orders — 2026-11-24

## What happened

`reconcileOrderNotifications` (`functions/src/orders/send_notification.ts`) is the two-minute
safety net for orders whose first Telegram attempt never completed: Eventarc drops, a Telegram
outage longer than the trigger's 10-minute retry window, or a long 429 cooldown.

Three paths refuse to announce an order staff cancelled — the trigger (`shouldNotifyKitchen`
requires `after.status !== 'Cancelled'`), the `sendOrderNotification` callable
(`failed-precondition`), and the kitchen board's read filter (`app/src/staff/kds-data.ts`
`isClosedKdsStatus`; the `kds_orders` mirror is still written so the cancelled ticket stays in
history). The reconciler only skipped cancelled orders that had **no** notification record at all:

```js
// pre-fix guard in reconcileMissedOrderNotifications
const terminal = orderDoc.data().status === 'Cancelled' || orderDoc.data().status === 'Completed';
if (terminal && !hasOrderNotificationState(notifData)) return false;
```

That guard exists so an order staff closed out immediately does not get a brand-new alert. But a
transient Telegram failure already wrote `telegramStatus: 'failed'` into
`order_notifications/{orderDocId}`, which counts as notification state — so the carve-out turned
into a hole:

1. A cash order is placed while Telegram returns 5xx; the trigger claims the notification, fails,
   and records `{ telegramSent: false, telegramStatus: 'failed', attempts: 1 }`.
2. Staff cancels the order (item out of stock, customer walked away).
3. Telegram recovers. The next sweep finds the order visible, not sent, old enough, and holding a
   reclaimable claim — and sends **"🔔 NEW ORDER — … ✅ Please prepare this order!"** for an order
   that no longer exists.

A kitchen tablet acting on that message starts cooking a cancelled order.

## Reproduction (written before the fix, against `functions/src` `HEAD`)

Added to the existing emulator test `functions/test/emulator/derived-views.test.js`: a cancelled
order plus a failed claim, alongside the orders that must still be reconciled.

```bash
cd functions && npm run build
node ../tool/with-java21.mjs npm exec --prefix .. --no -- firebase-tools emulators:exec \
  --project demo-lunaexpress --only functions,firestore \
  "node --test test/emulator/derived-views.test.js"
```

```
✖ notifyOrderOnce resumes partial multi-chat failures and reconcileMissedOrderNotifications catches missed orders (197.1004ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  4 !== 3
      at TestContext.<anonymous> (.../functions/test/emulator/derived-views.test.js:241:12)
```

`retried` counted four orders instead of the three that still need a notification; the fake bot
also received the cancelled order's message.

## Fix

`reconcileMissedOrderNotifications` now drops `status === 'Cancelled'` orders while building its
candidate list, before any `order_notifications` read, so the completed-order carve-out is never
consulted for a cancellation and no claim is read or rewritten for one. The jobs filter keeps its
own terminal guard as defence in depth.

| Path | Cancelled order announced? |
| --- | --- |
| `onOrderWritten` → `shouldNotifyKitchen` | no (before) |
| `sendOrderNotification` callable | no (403 failed-precondition, before) |
| `reconcileOrderNotifications` | **yes when a failed claim existed** → no (now) |

## Proof after the fix

```
✔ trigger mirrors orders and keeps daily stats exact (3961.9449ms)
✔ backfill rebuilds dailyStats and the mirror from orders alone (339.1484ms)
✔ notifyOrderOnce resumes partial multi-chat failures and reconcileMissedOrderNotifications catches missed orders (246.3794ms)
✔ reconcileMissedPaymentNotifications reclaims a payment alert that was sent but never persisted (138.002ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

The new assertions also pin the claim itself: `telegramSent` stays `false`,
`telegramStatus` stays `failed`, and no `reconcileAttempts` is written, so the order cannot be
retried into an alert later either.

Full local CI (`.github/workflows/pr-checks.yml` steps): recorded in
[`ci-local.txt`](ci-local.txt) — every executed step passes.

No UI change, so no screenshots: the defect and its fix are both server-side.

## Other audit notes from this pass

- **Firestore map-key field paths (checked, not a defect):** `dailyStats.items` keys are built by
  `statsItemKey(name, variant)` from menu text and, for multi-select items, client-supplied
  variant labels. Probed the emulator with `set({ items: { 'Name (a.b)': … } }, { merge: true })`
  for `.`, `~`, `*` and `[`/`]`: the Admin SDK stores all of them as literal map keys, so no
  character sanitising is needed.
- **Page-load health (checked, not a defect):** all 17 built routes (`/`, `/menu/`, `/404.html`,
  the seven kiosk pages, five staff pages, `/payment/success/`, `/payment/cancel/`) served
  locally and loaded in headless Chrome with zero exceptions and zero console errors; the
  receipt and GCash pages redirect as designed without a handoff.
- **Payment verification and reconciliation:** re-read `markOrderPaidOnce`,
  `markOrderPaymentFailed`, `verifyCheckoutPayment`, `persistCheckoutSession` and the webhook for
  the transaction-retry, session-binding and centavo-amount invariants in `CODING_STANDARDS.md`;
  all hold.
- **Rate limits, lockouts and lease TTLs:** `enforceFixedWindowRateLimit`,
  `checkAndRecordWindowFailure`, `checkRateLimit`, and the notification/daily-report claim
  helpers all bound their leases and re-read inside transactions.

## Documentation corrections in the same change

`SECURITY.md` described two behaviours that no longer exist, which could stall an operator:

- Item #1 and the manual-steps list omitted `PAYMONGO_WEBHOOK_SECRET`, which is now mandatory
  (the webhook rejects every delivery without it).
- Item #10 and step 5 claimed the first-run staff seed logs its random passwords. It does not —
  `verifyStaff`'s `ensureStaffSeeded` logs only the account name and a pointer to
  `functions/scripts/reset-staff-credentials.js`.
