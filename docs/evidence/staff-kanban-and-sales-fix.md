# Evidence: Staff Kanban, Admin Dashboard & Sales Analytics Fix

## Root Causes Found

1. **Pre-login fetch + silent mock fallback (`lib/screens/kds_page.dart`)**
   - `KdsPage.initState()` called `_fetchActiveOrders()` before staff authentication completed, causing `getActiveOrders` to throw `unauthenticated`.
   - The `catch (_)` block silently swallowed all errors and populated `_orders` with hardcoded `_sampleKdsOrders()` (`#2026-10-24-001` Maria Santos, etc.), and never re-fetched when `session.isStaff` became `true`.
2. **Broken offline PIN fallback without Firebase Auth (`lib/screens/staff_login_dialog.dart`)**
   - When `verifyStaff` timed out (15s) or failed, hardcoded PIN fallbacks (`0524`, `8888`) logged into the UI `Session` without signing into `FirebaseAuth.instance.signInWithCustomToken(token)`. Every subsequent `requireStaff()` callable (`getActiveOrders`, `updateOrderStatus`, `getSalesAnalytics`, `getLifetimeSalesReport`) then failed with `unauthenticated`.
3. **24-hour KDS lookback cutoff (`functions/src/orders/kds.ts`)**
   - `getActiveOrders` filtered `timestamp >= now - 24h`, hiding orders from yesterday (>24h ago) from both the active board and `HISTORY`. Extended to 7 days.
4. **Admin & Sales pages disconnected from auth/live data**
   - `AdminDashboard` (`lib/screens/admin_dashboard.dart`) read only in-memory `orderHistory` (always empty on reload/other devices) instead of calling `getSalesAnalytics` and `getActiveOrders`.
   - `AdminDashboard`, `AnalyticsPage`, and `LifetimeAnalyticsPage` lacked a `StaffLoginDialog` auth gate and swallowed `FirebaseFunctionsException` errors.
   - `getSalesAnalytics` (`functions/src/reporting/analytics.ts`) now also returns `totalItemsSold`.
5. **Mobile UI overflows & clipping (`lib/screens/kds_page.dart`, `lib/screens/admin_dashboard.dart`, `lib/widgets/report/report_widgets.dart`)**
   - `KdsPage` AppBar actions crushed the title on `<640px`; fixed with compact `LIVE KDS` header and overflow `PopupMenuButton` on `<460px`.
   - `KdsPage` control bar squeezed filter chips (`DELIVERY` clipped to `DE`) and vertically clipped `Search orders...`; fixed with a 2-row responsive layout on `<720px` and `isDense: true` input padding.
   - `KdsPage` mobile `TabBar` tabs (`PENDING`, `COOKING`, `READY`, `DONE`) wrapped with `FittedBox(fit: BoxFit.scaleDown)` and `OrderCard` rows converted to `Wrap`.
   - `ReportScaffold` title wrapped in `FittedBox` and `AdminDashboard` CTA wrapped in `Flexible` to eliminate 47px mobile overflow.

## Verification Results

- `flutter analyze --no-fatal-infos --no-fatal-warnings` + `node tool/check_analyzer_baseline.mjs`: **0 issues (baseline 0)**
- `flutter test` (all suites including new `390x844` & `320x640` mobile overflow and mock-order absence tests in `test/staff_kds_test.dart`): **48 passed, 0 failed**
- `flutter build web --release`: **Built `build/web` cleanly**
- `cd functions && tsc && node --test test/*.test.js`: **16 passed, 0 failed**
