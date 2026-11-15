import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/screens/menu_page.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/menu_preselect.dart';
import 'package:luna_bites_and_delights/services/session.dart';
import 'package:luna_bites_and_delights/widgets/kiosk/customization_modal.dart';

/// Every marked row on the landing page must land in the kiosk as the item
/// and price the row prints, or open that item's sheet when a flavour is still
/// to choose.
void main() {
  setUp(() {
    cartNotifier.clear();
    kioskSession.reset();
    resetStorefrontPicks();
  });

  test('every storefront row resolves at the price it prints', () {
    final html = File('site/index.html').readAsStringSync();
    final rows = RegExp(
      r'data-pick="([^"]+)"[\s\S]*?<span class="row__price">₱(\d+)</span>',
    ).allMatches(html).toList();
    expect(rows, hasLength(greaterThan(50)));

    for (final row in rows) {
      final pick = row.group(1)!.replaceAll('&amp;', '&');
      final printed = int.parse(row.group(2)!);
      final result = resolvePicks([pick]);
      expect(result.isEmpty, isFalse, reason: '$pick resolves to nothing');
      if (pick.startsWith('@')) continue;
      if (result.ready.isNotEmpty) {
        expect(result.ready.single.price, printed, reason: pick);
      } else {
        expect(result.needsChoice, hasLength(1), reason: pick);
      }
    }
  });

  test('variants, choices, sections and junk resolve as expected', () {
    final r = resolvePicks([
      's1#Solo',
      's8#Barkada (3–5 pax)',
      'b1',
      'f4',
      'f4',
      '@drinks',
      'nope',
      'header_coolers',
      's1#Made up',
    ]);
    expect(r.ready.map((c) => '${c.name}|${c.variant}|${c.price}'), [
      'Shawarma Wrap|Solo|60',
      'Nachos & Fries Overload|Barkada (3–5 pax)|150',
      'Burger Patty||55',
    ]);
    expect(r.needsChoice.map((m) => m.id), ['f4', 's1']);
    expect(r.sectionId, 'drinks', reason: 'a section pick decides the view');
    expect(r.sectionPick, isTrue);
    expect(resolvePicks(['b1']).sectionPick, isFalse);
  });

  test('picks are read once and only from the pick parameter', () {
    final uri = Uri.parse(
      'https://x.test/kiosk/?pick=s1%23Solo&pick=b1&other=1#/menu',
    );
    expect(takeStorefrontPicks(uri), ['s1#Solo', 'b1']);
    expect(takeStorefrontPicks(uri), isEmpty);
  });

  testWidgets('the menu opens with the picks in the cart and stays on menu', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: session),
          ChangeNotifierProvider.value(value: kioskSession),
          ChangeNotifierProvider.value(value: cartNotifier),
        ],
        child: MaterialApp(
          home: MenuPreselectHost(
            readPicks: () => ['s1#Solo', 'b4', 'f3'],
            child: const KioskMenuPage(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(cartNotifier.totalCount, 2);
    expect(cartNotifier.totalPrice, 60 + 85);
    expect(kioskSession.currentCategoryId, 'shawarma');
    expect(find.byType(KioskProductSheet), findsOneWidget);
    expect(find.text('Large Fries'), findsWidgets);

    await tester.tap(find.text('Cheese').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilledButton).last);
    await tester.pumpAndSettle();

    expect(find.byType(KioskProductSheet), findsNothing);
    expect(cartNotifier.totalCount, 3);
    expect(find.textContaining('Added 3 from the menu board'), findsOneWidget);
    expect(find.byType(KioskMenuPage), findsOneWidget);
  });
}
