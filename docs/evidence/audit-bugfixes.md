# Audit bugfixes evidence

## Summary of fixes

1. PayMongo GCash payment verification gate and webhook hardening ([verify_payment.ts](functions/src/payments/verify_payment.ts), [paymongo.ts](functions/src/payments/paymongo.ts), [webhook.ts](functions/src/payments/webhook.ts), [create_checkout.ts](functions/src/payments/create_checkout.ts), [gcash_checkout_page.dart](lib/screens/gcash_checkout_page.dart), [checkout_page.dart](lib/screens/checkout_page.dart)):
   - Added `verifyCheckoutPayment` Cloud Function (`functions/src/payments/verify_payment.ts`) and shared PayMongo verification/idempotency helpers (`functions/src/payments/paymongo.ts`).
   - `hasMatchingCheckoutSession(orderData, sessionId)` requires a non-empty `orderData.checkoutSessionId` matching `sessionId` before returning `PAID` or marking an order paid via `markOrderPaidOnce`.
   - `createCheckoutSession` rejects orders already marked `PAID`, rejects `qty < 1`, and rejects missing or unknown variants when `VARIANT_PRICES[name]` exists.
   - `GCashCheckoutPage` (`_verifyAndFinish`) calls `verifyCheckoutPayment` on both mobile WebView success redirect and web `I HAVE PAID — VIEW RECEIPT` tap instead of trusting client taps; unpaid attempts show an inline error banner and keep the customer on the payment screen.
   - `CheckoutPage` only calls `OrderService.recordLocalHistory` after GCash verification succeeds (unconfirmed `AWAITING_PAYMENT` / `PAYMENT_FAILED` GCash orders are excluded from `orderHistory`).

2. Kitchen Display System (KDS) unpaid GCash filtering, desktop 4th HISTORY column, and double-tap lock ([kds.ts](functions/src/orders/kds.ts), [derived.ts](functions/src/orders/derived.ts), [kds_page.dart](lib/screens/kds_page.dart)):
   - Added `isOrderVisibleInKds` and `toIsoTimestamp` in `functions/src/orders/kds.ts` so `getActiveOrders` and `onOrderWritten` (`kdsMirrorDoc` / `kds_orders`) exclude unpaid or failed online GCash orders until payment clears and handle invalid timestamps without throwing.
   - Added the `4. DONE / HISTORY` column to `KdsPage._buildDesktopKanbanBoard` when `_showCompleted` (`HISTORY` toggle) is enabled.
   - Guarded `_updateStatus` and card action buttons (`Cancel` and `_buildStatusActionButton`) with `_updatingOrderIds` per order to prevent duplicate concurrent status updates on rapid taps.

3. Auth, rate limiting, Telegram error fallback, and analytics consistency ([verify_staff.ts](functions/src/auth/verify_staff.ts), [security.ts](functions/src/util/security.ts), [telegram_api.ts](functions/src/telegram_api.ts), [analytics.ts](functions/src/reporting/analytics.ts), [aggregator.ts](functions/src/reporting/aggregator.ts), [daily_stats.ts](functions/src/reporting/daily_stats.ts), [format.dart](lib/utils/format.dart), [admin_dashboard.dart](lib/screens/admin_dashboard.dart), [analytics_page.dart](lib/screens/analytics_page.dart), [lifetime_analytics_page.dart](lib/screens/lifetime_analytics_page.dart), [order_service.dart](lib/services/order_service.dart)):
   - Scoped `verifyStaff` PIN lockout keys per `request.rawRequest?.ip` when present, upgraded legacy SHA-256 PIN hashes to scrypt upon successful login, and checked `updateStaffPin` against all staff hashes to prevent colliding PINs.
   - Moved `recordLoginFailure` increment and lockout writes inside a Firestore transaction in `functions/src/util/security.ts` and hardened `verifyPassword` hex/length validation before `crypto.timingSafeEqual`.
   - Extracted `isMarkdownParseError` in `functions/src/telegram_api.ts` so non-parse 400 errors (such as chat IDs containing `"400"`) do not falsely trigger plain-text MarkdownV2 fallback.
   - Standardized PHT calendar conversion (`toPht` + `phtDateLabel` in `lib/utils/format.dart`), safe `num` coercion in analytics screens (`admin_dashboard.dart`, `analytics_page.dart`, `lifetime_analytics_page.dart`), `formatMonthAxisLabel` year suffix in `LifetimeAnalyticsPage`, and `itemKey(name, variant)` + numeric quantity fallback (`Number(item.quantity || item.qty) || 1`) in `analytics.ts`, `aggregator.ts`, and `daily_stats.ts` (returning `null` from `aggregateDailySales` when `totalOrders === 0`).

4. Inactivity timer PopupRoute tracking, menu naming, and storefront copy ([inactivity_timer.dart](lib/services/inactivity_timer.dart), [navigation.dart](lib/services/navigation.dart), [menu_data.dart](lib/data/menu_data.dart), [llms.txt](site/llms.txt)):
   - Added `RouteHistoryObserver.isTopPageRoute` and registered a global `GestureBinding.instance.pointerRouter` listener in `InactivityWatcher` so pointer activity inside modal bottom sheets or dialogs resets the inactivity timer cleanly while inactive background routes still pause timers.
   - Renamed duplicate `Milo Float` (`cf_milo`) in Cream Floats to `Cream Milo Float` (also permitted in `create_checkout.ts`), removed the stray hotdog emoji from the `Burgers` section header, and updated `site/llms.txt` payment policy text to match online PayMongo GCash support.

5. Deferred item:
   - Legacy `pasugo_*` cleanup in `firestore.rules` was intentionally deferred because `firestore.rules` must continue matching production rules until rules are deployed separately.

## Local verification after final edit

Full run logs saved to [analyze.txt](docs/evidence/audit-bugfixes/analyze.txt) and [ci-checks.txt](docs/evidence/audit-bugfixes/ci-checks.txt):

- `flutter analyze --no-fatal-infos --no-fatal-warnings` + `node tool/check_analyzer_baseline.mjs` -> passed (`No issues found!`, `Analyzer issues: 0 (baseline 0).`).
- `dart format --output=none --set-exit-if-changed` on changed Dart files + `lib` + `test/audit_bugfixes_test.dart` -> passed (`Formatted 52 files (0 changed)`).
- `flutter test` -> passed (`84` tests passed, `0` failed, including 6 regression tests in [test/audit_bugfixes_test.dart](test/audit_bugfixes_test.dart)).
- `flutter build web --release` -> passed (`Built build\web`).
- `flutter build web --release --base-href=/kiosk/` + `dart run tool/assemble_site.dart` -> passed (`storefront: build/web/index.html (+27 files)`, `kiosk: build/web/kiosk/index.html`).
- `npm run test:site` -> passed (`25` passed, `0` failed).
- `npm --prefix functions run lint` -> passed (`0` errors).
- `npm --prefix functions run build` -> passed (`tsc` exited 0).
- `npm --prefix functions test` -> passed (`28` passed, `0` failed across 2 suites, including `hasMatchingCheckoutSession` and `isOrderVisibleInKds` tests in [functions/test/payment_reconciliation.test.js](functions/test/payment_reconciliation.test.js)).
- `npm --prefix functions audit --audit-level=high` -> passed (`0` high/critical vulnerabilities; 1 low, 16 moderate transitive).
- `npm --prefix functions run test:derived` (Firebase emulators) -> passed (`2` passed, `0` failed).
- `npm --prefix functions run test:rules` (Firebase Firestore emulator on JDK 21) -> passed (`23` passed, `0` failed across `6` suites).
- Local limitation: `npm --prefix functions run check:rules-drift` exits 2 locally because no GCP Application Default Credentials are configured on this host; `firestore.rules` is unchanged against `origin/main`.

## Emulator E2E KDS probe & rendered viewport captures

- Headless Chromium KDS + Firebase Auth/Functions/Firestore emulator probe ([kds-history-probe.txt](docs/evidence/audit-bugfixes/kds-history-probe.txt)):
  - `mirrorCount: 4`, `ghostInMirror: false` (unpaid GCash order excluded by `isOrderVisibleInKds`)
  - Clicked desktop `HISTORY` toggle (`clickedRect: { txt: "HISTORY", role: "button", count: 1 }`)
  - `hasDoneColumn: true`, `showsCompletedCustomer: true`, `hidesUnpaidCustomer: true`
- Captured KDS screenshots (checked against `1440x900`, `768x1024`, `390x844`, `320x640`):
  - [kds-history-1440.png](docs/evidence/audit-bugfixes/kds-history-1440.png)
  - [kds-history-768.png](docs/evidence/audit-bugfixes/kds-history-768.png)
  - [kds-390.png](docs/evidence/audit-bugfixes/kds-390.png)
  - [kds-320.png](docs/evidence/audit-bugfixes/kds-320.png)
- Captured Kiosk menu screenshots (`/kiosk/#/menu` across `1440x900`, `768x1024`, `390x844`, `320x640`):
  - [kiosk-1440.png](docs/evidence/audit-bugfixes/kiosk-1440.png)
  - [kiosk-768.png](docs/evidence/audit-bugfixes/kiosk-768.png)
  - [kiosk-390.png](docs/evidence/audit-bugfixes/kiosk-390.png)
  - [kiosk-320.png](docs/evidence/audit-bugfixes/kiosk-320.png)
