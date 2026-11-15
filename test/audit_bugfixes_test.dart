import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luna_bites_and_delights/data/menu_data.dart';
import 'package:luna_bites_and_delights/models/order.dart';
import 'package:luna_bites_and_delights/screens/gcash_checkout_page.dart';
import 'package:luna_bites_and_delights/screens/kds_page.dart';
import 'package:luna_bites_and_delights/screens/lifetime_analytics_page.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/inactivity_timer.dart';
import 'package:luna_bites_and_delights/services/navigation.dart';
import 'package:luna_bites_and_delights/services/order_service.dart';
import 'package:luna_bites_and_delights/services/session.dart';
import 'package:luna_bites_and_delights/utils/format.dart';
import 'package:provider/provider.dart';

void main() {
  group('Audit bugfixes regression suite', () {
    testWidgets(
      'GCashCheckoutPage blocks receipt bypass until verifyCheckoutPayment confirms PAID',
      (tester) async {
        var verifyPaid = false;
        final calls = <String>[];
        bool? poppedResult;

        Future<Map<String, dynamic>> fakeCall(
          String name, [
          Map<String, dynamic>? payload,
        ]) async {
          calls.add(name);
          if (name == 'createCheckoutSession') {
            return {
              'checkoutUrl': 'https://checkout.paymongo.com/cs_test_1',
              'checkoutSessionId': 'cs_test_1',
            };
          }
          if (name == 'verifyCheckoutPayment') {
            expect(payload?['orderDocId'], 'doc123');
            expect(payload?['checkoutSessionId'], 'cs_test_1');
            return verifyPaid
                ? {'paid': true, 'paymentStatus': 'PAID'}
                : {'paid': false, 'paymentStatus': 'AWAITING_PAYMENT'};
          }
          throw UnimplementedError(name);
        }

        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: ElevatedButton(
                  onPressed: () async {
                    poppedResult = await Navigator.push<bool>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => GCashCheckoutPage(
                          orderDocId: 'doc123',
                          orderId: 'LU-TEST-1',
                          amount: 99,
                          items: const [
                            {
                              'name': 'Shawarma Wrap',
                              'variant': 'Buy 1 Take 1',
                              'price': 99,
                              'quantity': 1,
                            },
                          ],
                          customerName: 'Ana Reyes',
                          customerPhone: '09171234567',
                          callFunction: fakeCall,
                          webCheckoutOverride: true,
                        ),
                      ),
                    );
                  },
                  child: const Text('OPEN CHECKOUT'),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.text('OPEN CHECKOUT'));
        await tester.pumpAndSettle();

        expect(calls, ['createCheckoutSession']);
        expect(find.text('I HAVE PAID — VIEW RECEIPT'), findsOneWidget);

        // First tap while unpaid must stay on page and surface error banner.
        await tester.tap(find.text('I HAVE PAID — VIEW RECEIPT'));
        await tester.pumpAndSettle();

        expect(calls, ['createCheckoutSession', 'verifyCheckoutPayment']);
        expect(poppedResult, isNull);
        expect(
          find.textContaining('Payment has not cleared yet'),
          findsOneWidget,
        );

        // Once server reports PAID, tapping again pops true to receipt.
        verifyPaid = true;
        await tester.tap(find.text('I HAVE PAID — VIEW RECEIPT'));
        await tester.pumpAndSettle();

        expect(poppedResult, isTrue);
      },
    );

    testWidgets(
      'KdsPage desktop layout renders 4. DONE / HISTORY column when HISTORY is toggled on',
      (tester) async {
        tester.view.physicalSize = const Size(1440, 900);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
          session.logout();
        });

        session.login('staff_desktop', role: 'staff');
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

        expect(find.text('1. PENDING QUEUE'), findsOneWidget);
        expect(find.text('2. PREPARING NOW'), findsOneWidget);
        expect(find.text('3. READY FOR PICKUP / RIDER'), findsOneWidget);
        expect(find.text('4. DONE / HISTORY'), findsNothing);

        await tester.tap(find.text('HISTORY'));
        await tester.pump();

        expect(tester.takeException(), isNull);
        expect(find.text('4. DONE / HISTORY'), findsOneWidget);
      },
    );

    test(
      'toPht converts UTC timestamps cleanly and lifetime chart labels show year',
      () {
        // 17:30 UTC is 01:30 next day in PHT (UTC+8).
        final utcLateNight = DateTime.utc(2026, 11, 14, 17, 30);
        expect(phtDateLabel(toPht(utcLateNight)), '2026-11-15');

        expect(formatMonthAxisLabel('2026-11'), "N '26");
        expect(formatMonthAxisLabel('2025-01'), "J '25");
        expect(formatMonthAxisLabel('unknown'), 'unknown');
      },
    );

    test('OrderService local history helper populates today totals safely', () {
      orderHistory.clear();
      addTearDown(orderHistory.clear);

      final today = phtDateLabel();
      OrderService.recordLocalHistory(
        OrderModel(
          orderId: 'LU-LOCAL-1',
          items: [
            OrderItem(
              name: 'Cream Milo Float',
              variant: '',
              price: 65,
              quantity: 2,
            ),
          ],
          totalAmount: 130,
          timestamp: DateTime.now(),
          dateLabel: today,
          type: 'Pickup',
          entryType: 'Kiosk',
          customerName: 'Ben Cruz',
          customerPhone: '09171234567',
          customerAddress: 'Pickup',
          paymentMethod: 'GCash',
          paymentStatus: 'PAID',
          status: 'Pending',
        ),
        '$today  14:00',
      );

      expect(todayOrderCount, 1);
      expect(todayRevenue, 130);
      expect(todayItemsSold, 2);
    });

    testWidgets(
      'InactivityWatcher resets on pointer taps inside a modal bottom sheet and times out if left idle',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            navigatorObservers: [appRouteObserver],
            routes: {
              '/': (context) => InactivityWatcher(
                alwaysActive: true,
                timeout: const Duration(seconds: 5),
                warningCountdown: const Duration(seconds: 3),
                child: Scaffold(
                  body: Builder(
                    builder: (context) => ElevatedButton(
                      onPressed: () {
                        showModalBottomSheet<void>(
                          context: context,
                          builder: (_) => SizedBox(
                            height: 180,
                            child: Center(
                              child: ElevatedButton(
                                onPressed: () {},
                                child: const Text('SHEET CONTENT'),
                              ),
                            ),
                          ),
                        );
                      },
                      child: const Text('OPEN SHEET'),
                    ),
                  ),
                ),
              ),
            },
          ),
        );

        await tester.tap(find.text('OPEN SHEET'));
        await tester.pumpAndSettle();
        expect(find.text('SHEET CONTENT'), findsOneWidget);

        // Wait 3s, then interact inside the PopupRoute; pointer tap resets timer to +5s.
        await tester.pump(const Duration(seconds: 3));
        expect(find.text('ARE YOU STILL THERE?'), findsNothing);
        await tester.tap(find.text('SHEET CONTENT'));

        // After another 3s (total ~6.3s since sheet opened, 3s since tap), timer has NOT fired.
        await tester.pump(const Duration(seconds: 3));
        await tester.pump();
        expect(find.text('ARE YOU STILL THERE?'), findsNothing);

        // Remaining idle past 5s since the sheet tap triggers ARE YOU STILL THERE?.
        await tester.pump(const Duration(milliseconds: 2200));
        await tester.pump();
        expect(find.text('ARE YOU STILL THERE?'), findsOneWidget);

        // Dismiss via YES button so pending timers clean up cleanly before dispose.
        await tester.tap(find.text('YES, I AM HERE'));
        await tester.pumpAndSettle();
      },
    );

    test(
      'menu data disambiguates Cream Milo Float and keeps Burgers header clean',
      () {
        final allItems = kMenuSections.expand((s) => s.items).toList();
        final creamFloat = allItems.firstWhere((i) => i.id == 'cf_milo');
        final crazeFloat = allItems.firstWhere((i) => i.id == 'mc2');
        final burgersSection = kMenuSections.firstWhere(
          (s) => s.id == 'burger_hotdog_combined',
        );

        expect(creamFloat.name, 'Cream Milo Float');
        expect(crazeFloat.name, 'Milo Float');
        expect(burgersSection.emoji, '🍔');
      },
    );
  });
}
