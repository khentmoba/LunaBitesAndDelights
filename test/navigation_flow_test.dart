import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/models/cart.dart';
import 'package:luna_bites_and_delights/screens/checkout_page.dart';
import 'package:luna_bites_and_delights/screens/kds_page.dart';
import 'package:luna_bites_and_delights/screens/menu_page.dart';
import 'package:luna_bites_and_delights/screens/receipt_page.dart';
import 'package:luna_bites_and_delights/screens/staff_menu.dart';
import 'package:luna_bites_and_delights/services/audio_alert_service.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/navigation.dart';
import 'package:luna_bites_and_delights/services/session.dart';

CartItem _sampleItem() => CartItem(
  id: 's1',
  name: 'S1 – Hungarian Sausage',
  emoji: '',
  imageUrl: 'images/hungarian_sausage_rice.png',
  variant: 'Solo',
  price: 99,
  quantity: 1,
);

Widget _withProviders(Widget child) => MultiProvider(
  providers: [
    ChangeNotifierProvider<Session>.value(value: session),
    ChangeNotifierProvider<KioskSession>.value(value: kioskSession),
    ChangeNotifierProvider<CartNotifier>.value(value: cartNotifier),
  ],
  child: child,
);

void main() {
  setUp(() {
    AudioAlertService.soundEnabled = false;
    cartNotifier.clear();
    kioskSession.reset();
    session.logout();
  });

  tearDown(() {
    cartNotifier.clear();
    kioskSession.reset();
    session.logout();
    AudioAlertService.soundEnabled = true;
  });

  test('CartNotifier increment/decrement ignore missing item ids safely', () {
    final cart = CartNotifier();
    cart.add(_sampleItem());
    var notifications = 0;
    cart.addListener(() => notifications++);

    cart.increment('missing-id');
    cart.decrement('missing-id');

    expect(notifications, 0);
    expect(cart.items.single.quantity, 1);
  });

  testWidgets(
    'StaffMenuDialog logout pops once, keeps menu mounted, and shows SnackBar safely',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      session.login('staff_kiosk', role: 'staff');
      cartNotifier.add(_sampleItem());

      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorObservers: [appRouteObserver],
            initialRoute: '/menu',
            routes: {'/menu': (_) => const KioskMenuPage()},
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Menu options'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Staff console'));
      await tester.pumpAndSettle();

      expect(find.byType(StaffMenuDialog), findsOneWidget);

      await tester.ensureVisible(find.text('LOGOUT STAFF PORTAL'));
      await tester.tap(find.text('LOGOUT STAFF PORTAL'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(session.isStaff, isFalse);
      expect(cartNotifier.items, isEmpty);
      expect(find.byType(StaffMenuDialog), findsNothing);
      expect(find.byType(KioskMenuPage), findsOneWidget);
      expect(find.text('STAFF LOGGED OUT'), findsOneWidget);
    },
  );

  testWidgets(
    'StaffMenuDialog WALK-IN ORDER pops cleanly and Navigator keeps single /menu',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      session.login('staff_kiosk', role: 'staff');

      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorObservers: [appRouteObserver],
            initialRoute: '/menu',
            routes: {'/menu': (_) => const KioskMenuPage()},
          ),
        ),
      );
      await tester.pumpAndSettle();

      final navState = tester.state<NavigatorState>(find.byType(Navigator));
      expect(appRouteObserver.isCurrentRoute(navState, '/menu'), isTrue);

      await tester.tap(find.byTooltip('Menu options'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Staff console'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('WALK-IN ORDER'));
      await tester.tap(find.text('WALK-IN ORDER'));
      await tester.pumpAndSettle();

      expect(find.byType(KioskMenuPage), findsOneWidget);
      expect(find.byType(StaffMenuDialog), findsNothing);
      expect(appRouteObserver.isCurrentRoute(navState, '/menu'), isTrue);
      expect(navState.canPop(), isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ReceiptPage ORDER AGAIN returns to /menu even when / is underneath (deep-link flow)',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final navKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorKey: navKey,
            navigatorObservers: [appRouteObserver],
            routes: {
              '/': (_) => const Scaffold(body: Text('Splash Screen')),
              '/menu': (_) => const Scaffold(body: Text('Menu Target')),
            },
            initialRoute: '/',
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.pushNamed('/menu');
      await tester.pumpAndSettle();
      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => ReceiptPage(
            orderNumber: 'LU-261115-010203',
            customerName: 'Ana',
            customerAddress: 'Purok 5',
            customerPhone: '09171234567',
            items: [_sampleItem()],
            total: 99,
            timeStr: '01:02 PM',
            isWalkIn: false,
            orderType: 'Pickup',
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('ORDER AGAIN'));
      await tester.tap(find.text('ORDER AGAIN'));
      await tester.pumpAndSettle();

      expect(find.text('Menu Target'), findsOneWidget);
      expect(find.text('Splash Screen'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ReceiptPage NEW WALK-IN ORDER returns to /menu instead of AdminDashboard',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final navKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorKey: navKey,
            navigatorObservers: [appRouteObserver],
            routes: {
              '/dashboard': (_) => const Scaffold(body: Text('Admin Screen')),
              '/menu': (_) => const Scaffold(body: Text('Menu Walk-In')),
            },
            initialRoute: '/dashboard',
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.pushNamed('/menu');
      await tester.pumpAndSettle();
      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => ReceiptPage(
            orderNumber: 'LU-261115-010204',
            customerName: 'Walk-in Customer',
            customerAddress: 'Walk-In',
            customerPhone: 'N/A',
            items: [_sampleItem()],
            total: 99,
            timeStr: '01:02 PM',
            isWalkIn: true,
            orderType: 'Walk-In',
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('NEW WALK-IN ORDER'));
      await tester.tap(find.text('NEW WALK-IN ORDER'));
      await tester.pumpAndSettle();

      expect(find.text('Menu Walk-In'), findsOneWidget);
      expect(find.text('Admin Screen'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'pushOrPopToRoute / pushNamedOrPopTo pop back instead of stacking duplicate Menu/KDS routes',
    (tester) async {
      final navKey = GlobalKey<NavigatorState>();
      var kdsBuilds = 0;

      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorKey: navKey,
            navigatorObservers: [appRouteObserver],
            initialRoute: '/kds',
            routes: {
              '/kds': (_) {
                kdsBuilds++;
                return const Scaffold(body: Text('KDS Board'));
              },
              '/menu': (_) => const Scaffold(body: Text('Menu Board')),
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(kdsBuilds, 1);

      pushNamedOrPopTo(navKey.currentState!, '/menu');
      await tester.pumpAndSettle();
      expect(find.text('Menu Board'), findsOneWidget);

      pushNamedOrPopTo(navKey.currentState!, '/kds');
      await tester.pumpAndSettle();
      expect(find.text('KDS Board'), findsOneWidget);
      expect(kdsBuilds, 1);
      expect(navKey.currentState!.canPop(), isFalse);
    },
  );

  testWidgets(
    'KioskMenuPage falls back to first section when category id is invalid',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      kioskSession.setCategory('nonexistent_category');

      await tester.pumpWidget(
        _withProviders(const MaterialApp(home: KioskMenuPage())),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('S1 – Hungarian Sausage'), findsOneWidget);
    },
  );

  testWidgets(
    'CheckoutPage explains blocked Delivery button and reacts when cart clears',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      cartNotifier.add(_sampleItem());

      await tester.pumpWidget(
        _withProviders(const MaterialApp(home: CheckoutPage())),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('DELIVERY'));
      await tester.pumpAndSettle();

      expect(
        find.text('Pin your delivery address on the map above to continue.'),
        findsOneWidget,
      );

      cartNotifier.clear();
      await tester.pumpAndSettle();

      expect(find.text('Your order slip is empty'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'KdsPage mobile DONE tab shows completed-orders empty copy and safe print fallback',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      session.login('staff_kiosk');
      final feed = StreamController<List<Map<String, dynamic>>>();
      addTearDown(feed.close);

      await tester.pumpWidget(
        _withProviders(MaterialApp(home: KdsPage(feed: () => feed.stream))),
      );
      feed.add([
        {
          'id': 'ord-1',
          'orderNumber': 'LU-261115-100001',
          'customerName': 'Ben',
          'customerPhone': '',
          'customerAddress': '',
          'lat': null,
          'lng': null,
          'deliveryFee': 0,
          'paymentMethod': 'Cash',
          'paymentStatus': 'NOT PAID',
          'entryType': 'Kiosk',
          'items': [
            {
              'name': 'Shawarma Wrap',
              'variant': '',
              'qty': 1,
              'quantity': 1,
              'price': 60,
            },
          ],
          'itemsCount': 1,
          'total': 60,
          'type': 'Pickup',
          'status': 'Pending',
          'timestamp': '2026-11-15T02:00:00.000Z',
        },
      ]);
      await tester.pump();
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'before opening ticket');

      await tester.tap(find.byTooltip('Kitchen Slip Ticket'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'inside ticket dialog');
      await tester.tap(find.text('PRINT SLIP'));
      await tester.pumpAndSettle();

      expect(
        find.text('Printing is available in the web browser'),
        findsOneWidget,
      );

      await tester.tap(find.text('DONE'));
      await tester.pumpAndSettle();
      expect(find.text('No completed orders yet.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Compact KdsPage POS and Sales & Admin actions pop back to existing named routes',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      session.login('admin');
      final feed = StreamController<List<Map<String, dynamic>>>();
      addTearDown(feed.close);

      var dashboardBuilds = 0;
      var menuBuilds = 0;
      final navKey = GlobalKey<NavigatorState>();

      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorKey: navKey,
            navigatorObservers: [appRouteObserver],
            initialRoute: '/dashboard',
            routes: {
              '/dashboard': (_) {
                dashboardBuilds++;
                return const Scaffold(body: Text('Dashboard Root'));
              },
              '/menu': (_) {
                menuBuilds++;
                return const Scaffold(body: Text('Menu Screen'));
              },
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(dashboardBuilds, 1);

      navKey.currentState!.push(
        MaterialPageRoute(
          settings: const RouteSettings(name: '/kds'),
          builder: (_) => KdsPage(feed: () => feed.stream),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      await tester.tap(find.byTooltip('Staff Menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sales & Admin'));
      await tester.pumpAndSettle();
      expect(find.text('Dashboard Root'), findsOneWidget);
      expect(dashboardBuilds, 1);
      expect(navKey.currentState!.canPop(), isFalse);

      navKey.currentState!.pushNamed('/menu');
      await tester.pumpAndSettle();
      expect(menuBuilds, 1);
      navKey.currentState!.push(
        MaterialPageRoute(
          settings: const RouteSettings(name: '/kds'),
          builder: (_) => KdsPage(feed: () => feed.stream),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      await tester.tap(find.text('POS'));
      await tester.pumpAndSettle();
      expect(find.text('Menu Screen'), findsOneWidget);
      expect(menuBuilds, 1);
    },
  );

  testWidgets(
    'ReceiptPage ORDER AGAIN opens KioskMenuPage even when /menu is absent from stack',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final navKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        _withProviders(
          MaterialApp(
            navigatorKey: navKey,
            navigatorObservers: [appRouteObserver],
            initialRoute: '/root',
            routes: {'/root': (_) => const Scaffold(body: Text('Splash Stub'))},
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => ReceiptPage(
            orderNumber: 'LU-261115-010205',
            customerName: 'Sam',
            customerAddress: 'Pickup',
            customerPhone: '09170000001',
            items: [_sampleItem()],
            total: 99,
            timeStr: '01:05 PM',
            isWalkIn: false,
            orderType: 'Pickup',
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('ORDER AGAIN'));
      await tester.tap(find.text('ORDER AGAIN'));
      await tester.pumpAndSettle();

      expect(find.text('Splash Stub'), findsNothing);
      expect(find.byType(KioskMenuPage), findsOneWidget);
      expect(
        appRouteObserver.isCurrentRoute(navKey.currentState!, '/menu'),
        isTrue,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
