# Kanban Live Order Reliability Proof

## Summary of Changes

1. **Atomic `kds_orders` mirror writes on every order write path (zero Eventarc cold-start delay or drop risk):**
   - `functions/src/orders/place_order.ts`: writes `kds_orders/{docId}` in the same Firestore transaction (idempotent path) or write batch (non-idempotent path) as `orders/{docId}` whenever `isOrderVisibleInKds(payload)` is true (Cash and Staff orders; unpaid GCash orders remain excluded until paid).
   - `functions/src/orders/kds.ts`: `applyOrderStatus` atomically updates `kds_orders/{orderId}` inside the same transaction as `orders/{orderId}` when `mirrorRef` is passed.
   - `functions/src/payments/paymongo.ts`: `markOrderPaidOnce` atomically writes `kds_orders/{orderId}` inside the same transaction when a GCash order transitions to `PAID`.
   - `functions/src/orders/derived.ts`: `onOrderWritten` remains active as an idempotent backup/sync trigger for `kds_orders`, `dailyStats`, and Telegram notifications.

2. **Always-on tablet KDS client resilience (`app/src/staff/kds.ts`, `kds-data.ts`, `chime.ts`, `kds.css`):**
   - **Stale-cache watchdog:** if Firestore's `onSnapshot` stays in `metadata.fromCache === true` while online for >8s, the board automatically starts `getActiveOrders` polling (10s) and listener reconnect retries (60s) until a server-backed snapshot (`!fromCache`) arrives.
   - **Reconnect, wake-up, and manual sync recovery:** `online`, `visibilitychange`, and the SYNC/RETRY buttons now trigger catch-up sync and restart the live listener whenever `!isLive || fromCache`.
   - **Cache-clobber protection:** `shouldSkipUnchangedLiveSnapshot` always protects fresher server-polled data (`polledFresh`) from being overwritten by stale `fromCache` snapshots.
   - **Screen Wake Lock (`navigator.wakeLock`):** acquires a screen wake lock while KDS is visible, re-acquires on `visibilitychange`, and releases cleanly on teardown/auth halt.
   - **AudioContext auto-unlock:** `unlockAudio()` unlocks the Web Audio context on the first `pointerdown`/`keydown` gesture and prevents chimes from queuing in a suspended context.
   - **At-a-glance live cues:** tab title reflects the live Pending count (`(N) Luna Live Operations`) and `.kbar__dot.is-live` pulses softly while server-connected (disabled under `prefers-reduced-motion: reduce`).

## Verification

- **Full local CI (`npm run ci`):** `all 12 executed step(s) passed` (see `docs/evidence/ci-local.txt`), including:
  - `functions` unit tests: 145/145 passed (new tests for `applyOrderStatus` mirror write, unpaid GCash exclusion, and `markOrderPaidOnce` atomic mirror write).
  - `rules` emulator tests: 25/25 passed.
  - `derived-views` emulator tests: 5/5 passed (new E2E test confirming `kds_orders/{docId}` exists immediately after `placeOrder` returns and updates immediately after `updateOrderStatus`, while unpaid GCash stays excluded).
  - `site` tests: 106/106 passed (new behavioral test verifying live snapshot arrival, chime trigger, tab title count, live dot class, and `online` recovery from stuck `fromCache`).
- **Real Chrome + Firebase Emulators E2E (`tool/parity/staff_e2e.mjs`):**
  - 0 console errors, 0 uncaught exceptions.
  - Staff PIN login -> live KDS board (`Purok 5 Kiosk · Live`) -> `START PREPARING` (`mirrorStatus: "Preparing"`) -> `MARK AS READY` (`mirrorStatus: "Ready"`) -> 1440px wide board and 390px mobile tabbed board verified.
