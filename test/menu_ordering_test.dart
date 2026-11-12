import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/data/menu_data.dart';
import 'package:luna_bites_and_delights/models/cart.dart';
import 'package:luna_bites_and_delights/models/menu.dart';
import 'package:luna_bites_and_delights/screens/cart_page.dart';
import 'package:luna_bites_and_delights/screens/menu_page.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/session.dart';
import 'package:luna_bites_and_delights/widgets/kiosk/customization_modal.dart';

MenuItem menuItem(String id) => kMenuSections
    .expand((section) => section.items)
    .firstWhere((item) => item.id == id);

Future<void> openItem(WidgetTester tester, String id) async {
  tester.view.physicalSize = const Size(320, 740);
  tester.view.devicePixelRatio = 1;
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              builder: (_) => KioskProductSheet(item: menuItem(id)),
            ),
            child: const Text('Open item'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open item'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    cartNotifier.clear();
    kioskSession.reset();
  });

  tearDown(() {
    cartNotifier.clear();
    kioskSession.reset();
  });

  testWidgets('single option and quantity reach cart with the exact price', (
    tester,
  ) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await openItem(tester, 's1');
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.ensureVisible(find.text('Buy 1 Take 1'));
    await tester.tap(find.text('Buy 1 Take 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Increase quantity'));
    await tester.pumpAndSettle();
    expect(find.text('Add to order · ₱198'), findsOneWidget);
    await tester.tap(find.text('Add to order · ₱198'));
    await tester.pumpAndSettle();
    expect(cartNotifier.items.single.variant, 'Buy 1 Take 1');
    expect(cartNotifier.items.single.price, 99);
    expect(cartNotifier.items.single.quantity, 2);
    expect(cartNotifier.totalPrice, 198);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'multi-select keeps its cap and preserves the fixed bundle price',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await openItem(tester, 'f4');
      for (final label in ['Cheese', 'BBQ', 'Sour Cream']) {
        await tester.ensureVisible(find.text(label));
        await tester.tap(find.text(label));
        await tester.pumpAndSettle();
      }
      final options = tester.widgetList<CheckboxListTile>(
        find.byType(CheckboxListTile),
      );
      expect(options.where((option) => option.value == true).length, 2);
      expect(find.text('Choose up to 2 flavours.'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to order · ₱50'));
      await tester.pumpAndSettle();
      expect(cartNotifier.items.single.variant, 'Cheese, BBQ');
      expect(cartNotifier.totalPrice, 50);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Barkada overload size and quantity reach cart at poster price', (
    tester,
  ) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await openItem(tester, 's8');
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.ensureVisible(find.text('Barkada (3–5 pax)'));
    await tester.tap(find.text('Barkada (3–5 pax)'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Increase quantity'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to order · ₱300'));
    await tester.pumpAndSettle();
    expect(cartNotifier.items.single.variant, 'Barkada (3–5 pax)');
    expect(cartNotifier.items.single.price, 150);
    expect(cartNotifier.items.single.quantity, 2);
    expect(cartNotifier.totalPrice, 300);
    expect(tester.takeException(), isNull);
  });

  for (final entry in [
    ('fd4', 'D4 – Fries + Hotdog + Cheesestick + Fried Siomai + Drink', 89),
    ('s10', 'Combo 6 – Shawarma Wrap + Shawarma Burger + Drink', 150),
    ('e7', 'Vanilla Cheese Ice Cream', 65),
  ]) {
    testWidgets('${entry.$1} poster item reaches cart at 320px', (
      tester,
    ) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await openItem(tester, entry.$1);
      // Full names must remain readable in the details sheet even when the
      // product grid needs to truncate them. Fixed-price bundles need no options.
      expect(find.text(entry.$2), findsOneWidget);
      await tester.tap(find.byTooltip('Increase quantity'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to order · ₱${entry.$3 * 2}'));
      await tester.pumpAndSettle();
      expect(cartNotifier.items.single.name, entry.$2);
      expect(cartNotifier.items.single.price, entry.$3);
      expect(cartNotifier.items.single.quantity, 2);
      expect(cartNotifier.totalPrice, entry.$3 * 2);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('closing item details does not add an order', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await openItem(tester, 'e3');
    await tester.tap(find.byTooltip('Close item details'));
    await tester.pumpAndSettle();
    expect(cartNotifier.items, isEmpty);
    expect(find.byType(KioskProductSheet), findsNothing);
  });

  testWidgets('320px menu supports large text without layout exceptions', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: kioskSession,
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: const KioskMenuPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sulit Meals'), findsWidgets);
    expect(tester.takeException(), isNull);
    kioskSession.setCategory('drinks');
    await tester.pumpAndSettle();
    expect(find.text('Refreshments'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });

  testWidgets('cart order slip updates quantities and cancels back to /', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    cartNotifier.clear();
    cartNotifier.add(
      CartItem(
        id: 'line-1',
        name: 'Shawarma Wrap',
        emoji: '',
        imageUrl: 'images/shawarma_wrap.png',
        variant: '',
        price: 60,
        quantity: 1,
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        initialRoute: '/cart',
        routes: {
          '/': (_) => const Scaffold(body: Text('Splash Home')),
          '/cart': (_) => const KioskCartPage(),
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Order slip'), findsOneWidget);
    expect(find.text('1 item'), findsOneWidget);
    expect(find.text('₱60'), findsWidgets);

    await tester.tap(find.byTooltip('One more Shawarma Wrap'));
    await tester.pumpAndSettle();
    expect(find.text('2 items'), findsOneWidget);
    expect(find.text('₱120'), findsWidgets);

    await tester.tap(find.text('Cancel order'));
    await tester.pumpAndSettle();
    expect(cartNotifier.items, isEmpty);
    expect(find.text('Splash Home'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
