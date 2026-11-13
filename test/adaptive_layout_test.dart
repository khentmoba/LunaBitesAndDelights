import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luna_bites_and_delights/main.dart';
import 'package:luna_bites_and_delights/models/cart.dart';
import 'package:luna_bites_and_delights/screens/cart_page.dart';
import 'package:luna_bites_and_delights/screens/checkout_page.dart';
import 'package:luna_bites_and_delights/screens/receipt_page.dart';
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
}
