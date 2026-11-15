# Navigation flow and runtime bug fixes evidence

## Summary of fixes

1. Route deduplication and clean navigation (`lib/services/navigation.dart`, `lib/main.dart`, `lib/screens/splash_screen.dart`, `lib/screens/menu_page.dart`, `lib/screens/staff_menu.dart`, `lib/screens/admin_dashboard.dart`, `lib/screens/kds_page.dart`):
   - Registered `appRouteObserver` (`RouteHistoryObserver`) on `LunaExpressApp` (`lib/main.dart`).
   - Added `pushOrPopToRoute` and `pushNamedOrPopTo` to pop back to existing `/menu`, `/kds`, or `/dashboard` routes instead of stacking duplicates (and fall back cleanly when `MaterialApp` omits `appRouteObserver`).
   - Named the Splash transition route (`'/menu'` or `'/dashboard'`) in `lib/screens/splash_screen.dart`.
   - Extracted `_openMenu()` and `_openDashboard()` helpers in `lib/screens/kds_page.dart` so compact (`width < 460`) and regular AppBar actions share the same route deduplication and names.

2. Deactivated context crashes and logout double-pop (`lib/screens/staff_menu.dart`, `lib/screens/staff_login_dialog.dart`, `lib/screens/receipt_page.dart`):
   - Captured `NavigatorState` and `ScaffoldMessengerState` before popping dialogs in `StaffMenuDialog` and `StaffLoginDialog`.
   - Fixed `LOGOUT STAFF PORTAL` double-pop in `StaffMenuDialog` so logging out from the menu stays on `KioskMenuPage` instead of popping it to an empty navigator.
   - Captured `final nav = Navigator.of(context)` before `nav.popUntil(...)` in `ReceiptPage` so `ORDER AGAIN` / `NEW WALK-IN ORDER` returns to `/menu` (or replaces a non-`/menu` root with `KioskMenuPage`) instead of exiting onto Splash or Dashboard.

3. State safety, checkout flow, map picker, and print fallback (`lib/services/cart_notifier.dart`, `lib/screens/menu_page.dart`, `lib/screens/checkout_page.dart`, `lib/screens/map_picker_page.dart`, `lib/screens/kds_page.dart`, `lib/services/url_helper*.dart`):
   - Replaced unchecked `_items.firstWhere` calls in `CartNotifier.increment` and `CartNotifier.decrement` with `indexWhere` guards against missing items.
   - Added `orElse: () => kMenuSections.first` to `KioskMenuPage._buildProductGrid`.
   - Wrapped `CheckoutPage` body in `ListenableBuilder(listenable: cartNotifier, ...)` so an external cart clear updates the UI, and added an inline cue (`Pin your delivery address on the map above to continue.`) when Delivery coordinates are missing.
   - Filtered `MapEventSource.mapController` in `MapPickerPage` `onMapEvent` and cancelled pending address debounce timers on programmatic moves so selecting a search result is not overwritten.
   - Added `printCurrentPage()` (`window.print()` via `dart:js_interop` on web, `false` on non-web stub) for KDS kitchen ticket printing with an in-app snackbar fallback outside browsers.
   - Updated `KdsPage` Completed tab empty copy (`No completed orders yet.`) and wrapped `PopupMenuItem` labels and ticket dialog rows with `Flexible` / `SingleChildScrollView` to prevent mobile horizontal overflows.

## Local verification after final edit

- `dart format --output=none --set-exit-if-changed lib test` -> passed (`Formatted 63 files (0 changed)`).
- `flutter analyze --no-fatal-infos --no-fatal-warnings` + `node tool/check_analyzer_baseline.mjs` -> passed (`Analyzer issues: 0 (baseline 0).`).
- `flutter test` -> passed (`78` passed, `0` failed, including 11 new tests in `test/navigation_flow_test.dart`).
- `flutter build web --release --base-href=/kiosk/` -> passed (`Built build\web`).
- `dart run tool/assemble_site.dart` -> passed (`storefront: build/web/index.html (+27 files)`, `kiosk: build/web/kiosk/index.html`).
- `npm run test:site` -> passed (`25` passed, `0` failed).
- `npm --prefix functions run lint` -> passed (`0` errors).
- `npm --prefix functions test` -> passed (`tsc` build + `24` passed, `0` failed).
- `npm --prefix functions run test:rules` (with Android Studio JBR OpenJDK 21.0.10) -> passed (`23` passed, `0` failed across `6` suites).
- Not run locally: `npm --prefix functions run check:rules-drift` (no GCP Application Default Credentials configured on this host; `firestore.rules` was not modified).

## Rendered viewport captures (visual preservation)

Headless Chromium captures against assembled `build/web` (`/kiosk/` and `/kiosk/#/menu`):

- `docs/evidence/navigation-flow/kiosk-splash-390.png` (390x844 mobile splash)
- `docs/evidence/navigation-flow/kiosk-menu-320.png` (320x640 compact mobile menu)
- `docs/evidence/navigation-flow/kiosk-menu-390.png` (390x844 mobile menu)
- `docs/evidence/navigation-flow/kiosk-menu-768.png` (768x1024 tablet menu)
- `docs/evidence/navigation-flow/kiosk-menu-1440.png` (1440x900 desktop menu)
