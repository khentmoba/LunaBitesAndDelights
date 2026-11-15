// Staff-only screens, loaded on demand through staff_screens.dart so the
// customer kiosk never downloads them. Import this file only as `deferred`.
import 'package:flutter/widgets.dart';
import 'admin_dashboard.dart';
import 'analytics_page.dart';
import 'kds_page.dart';
import 'lifetime_analytics_page.dart';
import 'staff_screens.dart';

Widget buildStaffScreen(StaffScreen screen) => switch (screen) {
  StaffScreen.dashboard => const AdminDashboard(),
  StaffScreen.kds => const KdsPage(),
  StaffScreen.analytics => const AnalyticsPage(),
  StaffScreen.lifetimeAnalytics => const LifetimeAnalyticsPage(),
};
