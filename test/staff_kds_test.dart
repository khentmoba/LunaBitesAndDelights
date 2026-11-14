import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/services/session.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/audio_alert_service.dart';
import 'package:luna_bites_and_delights/screens/staff_login_dialog.dart';
import 'package:luna_bites_and_delights/screens/kds_page.dart';
import 'package:luna_bites_and_delights/screens/admin_dashboard.dart';
import 'package:luna_bites_and_delights/screens/analytics_page.dart';
import 'package:luna_bites_and_delights/screens/lifetime_analytics_page.dart';

void main() {
  group('Staff Session & Audio Alert Tests', () {
    test('Session initializes and transitions login/logout state', () {
      final testSession = Session();
      expect(testSession.isStaff, isFalse);
      expect(testSession.username, isEmpty);

      testSession.login('staff_anna');
      expect(testSession.isStaff, isTrue);
      expect(testSession.username, 'staff_anna');

      testSession.logout();
      expect(testSession.isStaff, isFalse);
      expect(testSession.username, isEmpty);
    });

    test('Session tracks staff vs admin role properly', () {
      final testSession = Session();
      testSession.login('staff1', role: 'staff');
      expect(testSession.isStaff, isTrue);
      expect(testSession.isAdmin, isFalse);
      expect(testSession.role, 'staff');

      testSession.login('admin', role: 'admin');
      expect(testSession.isStaff, isTrue);
      expect(testSession.isAdmin, isTrue);
      expect(testSession.role, 'admin');

      testSession.logout();
      expect(testSession.isStaff, isFalse);
      expect(testSession.isAdmin, isFalse);
    });

    test('AudioAlertService toggles sound state reliably', () {
      AudioAlertService.soundEnabled = true;
      expect(AudioAlertService.soundEnabled, isTrue);

      // Should not throw
      AudioAlertService.playOrderChime();

      AudioAlertService.soundEnabled = false;
      expect(AudioAlertService.soundEnabled, isFalse);
      AudioAlertService.playOrderChime();

      AudioAlertService.soundEnabled = true;
    });

    testWidgets('StaffLoginDialog displays Quick PIN keypad by default', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: StaffLoginDialog())),
      );
      await tester.pumpAndSettle();

      expect(find.text('STAFF OPERATIONS'), findsOneWidget);
      expect(find.text('QUICK PIN'), findsOneWidget);
      expect(find.text('PASSWORD'), findsOneWidget);
      expect(find.text('ENTER 4–8 DIGIT PIN'), findsOneWidget);

      // Check keypad digits exist
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('0'), findsOneWidget);

      // Tap digits 1, 2, 3
      await tester.tap(find.text('1'));
      await tester.pump();
      await tester.tap(find.text('2'));
      await tester.pump();
      await tester.tap(find.text('3'));
      await tester.pump();

      // Switch to PASSWORD tab
      await tester.tap(find.text('PASSWORD'));
      await tester.pumpAndSettle();

      expect(find.text('USERNAME'), findsOneWidget);
      expect(find.text('PASSWORD'), findsWidgets);
      expect(find.text('LOG IN'), findsOneWidget);
    });

    testWidgets('KdsPage renders operations board when staff is logged in', (
      tester,
    ) async {
      session.login('staff_kiosk');

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: session),
            ChangeNotifierProvider.value(value: kioskSession),
            ChangeNotifierProvider.value(value: cartNotifier),
          ],
          child: const MaterialApp(home: KdsPage()),
        ),
      );
      await tester.pump();

      expect(find.text('LUNA LIVE OPERATIONS'), findsOneWidget);
      expect(find.text('ALL'), findsOneWidget);
      expect(find.text('DELIVERY'), findsWidgets);
      expect(find.text('PICKUP'), findsWidgets);
      expect(find.text('WALK-IN'), findsWidgets);
      expect(find.text('POS WALK-IN'), findsOneWidget);
      expect(find.text('Maria Santos'), findsNothing);
      expect(find.text('#2026-10-24-001'), findsNothing);

      session.logout();
    });

    testWidgets(
      'KdsPage mobile layout (390x844 & 320x640) renders without overflow or mock orders',
      (tester) async {
        session.login('staff_kiosk');

        for (final size in [const Size(390, 844), const Size(320, 640)]) {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1.0;

          await tester.pumpWidget(
            MultiProvider(
              providers: [
                ChangeNotifierProvider.value(value: session),
                ChangeNotifierProvider.value(value: kioskSession),
                ChangeNotifierProvider.value(value: cartNotifier),
              ],
              child: const MaterialApp(home: KdsPage()),
            ),
          );
          await tester.pump();

          expect(tester.takeException(), isNull);
          expect(find.text('LIVE KDS'), findsOneWidget);
          expect(find.text('ALL'), findsOneWidget);
          expect(find.text('DELIVERY'), findsOneWidget);
          expect(find.text('HISTORY'), findsOneWidget);
          expect(find.text('PENDING'), findsOneWidget);
          expect(find.text('COOKING'), findsOneWidget);
          expect(find.text('READY'), findsOneWidget);
          expect(find.text('DONE'), findsOneWidget);
          expect(find.text('Maria Santos'), findsNothing);
        }

        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
        session.logout();
      },
    );

    testWidgets(
      'AdminDashboard, AnalyticsPage, and LifetimeAnalyticsPage require staff login and render cleanly on mobile',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;

        for (final page in const [
          AdminDashboard(),
          AnalyticsPage(),
          LifetimeAnalyticsPage(),
        ]) {
          session.logout();
          await tester.pumpWidget(
            MultiProvider(
              providers: [
                ChangeNotifierProvider.value(value: session),
                ChangeNotifierProvider.value(value: kioskSession),
                ChangeNotifierProvider.value(value: cartNotifier),
              ],
              child: MaterialApp(home: page),
            ),
          );
          await tester.pump();
          expect(find.text('STAFF OPERATIONS'), findsOneWidget);
          expect(tester.takeException(), isNull);

          session.login('admin', role: 'admin');
          await tester.pump();
          expect(tester.takeException(), isNull);
        }

        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
        session.logout();
      },
    );
  });
}
