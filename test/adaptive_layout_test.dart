import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/main.dart';
import 'package:luna_bites_and_delights/models/cart.dart';
import 'package:luna_bites_and_delights/screens/admin_dashboard.dart';
import 'package:luna_bites_and_delights/screens/cart_page.dart';
import 'package:luna_bites_and_delights/screens/checkout_page.dart';
import 'package:luna_bites_and_delights/screens/map_picker_page.dart';
import 'package:luna_bites_and_delights/screens/receipt_page.dart';
import 'package:luna_bites_and_delights/screens/splash_screen.dart';
import 'package:luna_bites_and_delights/screens/staff_login_dialog.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/session.dart';

void main() {
  tearDown(() {
    cartNotifier.clear();
    session.logout();
  });

  testWidgets(
    'LunaExpressApp configures adaptive density and platform transitions',
    (tester) async {
      await tester.pumpWidget(const LunaExpressApp());
      await tester.pump();
      final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
      final theme = app.theme!;
      expect(theme.visualDensity, VisualDensity.adaptivePlatformDensity);
      expect(
        theme.pageTransitionsTheme.builders[TargetPlatform.iOS],
        isA<CupertinoPageTransitionsBuilder>(),
      );
      expect(
        theme.pageTransitionsTheme.builders[TargetPlatform.android],
        isA<PredictiveBackPageTransitionsBuilder>(),
      );
    },
  );

  testWidgets('KioskCartPage uses platform-adaptive back icon', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      await tester.pumpWidget(const MaterialApp(home: KioskCartPage()));
      expect(find.byIcon(Icons.adaptive.arrow_back), findsOneWidget);

      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      await tester.pumpWidget(const MaterialApp(home: KioskCartPage()));
      expect(find.byIcon(Icons.adaptive.arrow_back), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets(
    'CheckoutPage renders cleanly at 320px phone and constrains at 1280px',
    (tester) async {
      cartNotifier.add(
        CartItem(
          id: '1',
          name: 'Shawarma Wrap',
          emoji: '',
          imageUrl: '',
          variant: 'Regular',
          price: 60,
          quantity: 2,
        ),
      );

      // 320px narrow phone with staff 3-button order type row
      session.login('tester', role: 'staff');
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(const MaterialApp(home: CheckoutPage()));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('WALK-IN'), findsOneWidget);
      expect(find.text('PICKUP'), findsOneWidget);
      expect(find.text('DELIVERY'), findsOneWidget);

      // 1280px desktop constrains form column to max 760px
      tester.view.physicalSize = const Size(1280, 800);
      await tester.pumpWidget(const MaterialApp(home: CheckoutPage()));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final constrained = find.descendant(
        of: find.byType(SingleChildScrollView),
        matching: find.byType(ConstrainedBox),
      );
      expect(tester.getSize(constrained.first).width, lessThanOrEqualTo(760));
    },
  );

  testWidgets(
    'ReceiptPage renders cleanly at 320px phone and constrains at 1280px',
    (tester) async {
      final items = [
        CartItem(
          id: '1',
          name: 'Cheese & Egg Burger',
          emoji: '',
          imageUrl: '',
          variant: 'B1T1',
          price: 95,
          quantity: 1,
        ),
      ];

      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptPage(
            orderNumber: 'LU-261029-123456',
            customerName: 'Juan Dela Cruz',
            customerAddress: 'Purok 5, Poblacion, Magallanes',
            customerPhone: '09171234567',
            items: items,
            total: 95,
            timeStr: '12:00 PM',
            isWalkIn: false,
            orderType: 'Delivery',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('ORDER # LU-261029-123456'), findsOneWidget);

      tester.view.physicalSize = const Size(1280, 800);
      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptPage(
            orderNumber: 'LU-261029-123456',
            customerName: 'Juan Dela Cruz',
            customerAddress: 'Purok 5, Poblacion, Magallanes',
            customerPhone: '09171234567',
            items: items,
            total: 95,
            timeStr: '12:00 PM',
            isWalkIn: false,
            orderType: 'Delivery',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final constrained = find.descendant(
        of: find.byType(SingleChildScrollView),
        matching: find.byType(ConstrainedBox),
      );
      expect(tester.getSize(constrained.first).width, lessThanOrEqualTo(760));
    },
  );

  testWidgets(
    'KioskSplashScreen adapts to 320px portrait, landscape phone, and Reduce Motion',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.view.devicePixelRatio = 1;

      for (final size in [const Size(320, 568), const Size(640, 360)]) {
        tester.view.physicalSize = size;
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(size: size, disableAnimations: true),
              child: const KioskSplashScreen(),
            ),
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.text('Start my order'), findsOneWidget);
      }
    },
  );

  testWidgets(
    'KioskCartPage steppers meet 44px touch targets and compact mobile bar',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      cartNotifier.add(
        CartItem(
          id: '1',
          name: 'Shawarma Wrap',
          emoji: '',
          imageUrl: '',
          variant: 'Regular',
          price: 60,
          quantity: 1,
        ),
      );

      await tester.pumpWidget(const MaterialApp(home: KioskCartPage()));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      final decSize = tester.getSize(find.byTooltip('One less Shawarma Wrap'));
      final incSize = tester.getSize(find.byTooltip('One more Shawarma Wrap'));
      expect(decSize.width, greaterThanOrEqualTo(44));
      expect(decSize.height, greaterThanOrEqualTo(44));
      expect(incSize.width, greaterThanOrEqualTo(44));
      expect(incSize.height, greaterThanOrEqualTo(44));
      expect(find.text('Checkout'), findsOneWidget);
      expect(find.text('Add more'), findsOneWidget);
    },
  );

  testWidgets(
    'MapPickerPage uses native FlutterMap on Android and iOS with one-handed confirm CTA',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
        debugDefaultTargetPlatformOverride = platform;
        try {
          await tester.pumpWidget(
            const MaterialApp(
              home: MapPickerPage(
                initialAddress: 'Purok 5, Magallanes',
                initialLat: 9.0205,
                initialLng: 125.5176,
              ),
            ),
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 50));
          expect(tester.takeException(), isNull);
          expect(find.byType(FlutterMap), findsOneWidget);
          expect(find.text('CONFIRM LOCATION'), findsOneWidget);
          final mapRect = tester.getRect(find.byType(FlutterMap));
          final pinRect = tester.getRect(
            find.byKey(const Key('map_center_pin')),
          );
          expect(pinRect.bottom, closeTo(mapRect.center.dy, 12));
          final myLocSize = tester.getSize(
            find.bySemanticsLabel('Use my current location'),
          );
          expect(myLocSize.width, greaterThanOrEqualTo(48));
          expect(myLocSize.height, greaterThanOrEqualTo(48));
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pump(const Duration(seconds: 12));
        } finally {
          debugDefaultTargetPlatformOverride = null;
        }
      }
    },
  );

  testWidgets(
    'StaffLoginDialog and AdminDashboard fit 320px phone without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: StaffLoginDialog())),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('STAFF OPERATIONS'), findsOneWidget);
      for (var i = 0; i < 8; i++) {
        await tester.tap(find.text('1'));
        await tester.pump();
      }
      expect(tester.takeException(), isNull);

      session.login('admin_user', role: 'admin');
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: session),
            ChangeNotifierProvider.value(value: kioskSession),
            ChangeNotifierProvider.value(value: cartNotifier),
          ],
          child: const MaterialApp(home: AdminDashboard()),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.text('Luna Bites & Delights'), findsOneWidget);
      expect(find.byTooltip('Logout'), findsOneWidget);
    },
  );
}
