import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/screens/menu_page.dart';
import 'package:luna_bites_and_delights/services/session.dart';

void main() {
  testWidgets(
    'KioskMenuPage displays Sulit Meals and Chicken Poppers categories',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      kioskSession.reset();

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<KioskSession>.value(value: kioskSession),
          ],
          child: const MaterialApp(home: KioskMenuPage()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Sulit Meals'), findsWidgets);
      expect(find.text('Chicken Poppers'), findsWidgets);

      expect(find.text('S1 – Hungarian Sausage'), findsOneWidget);
      expect(find.text('S2 – Pork Tocino'), findsOneWidget);
      expect(find.text('S3 – Shawarma Rice'), findsOneWidget);
      expect(find.text("Luna's Pork Sisig"), findsOneWidget);

      kioskSession.setCategory('chicken_poppers');
      await tester.pumpAndSettle();

      expect(find.text('Korean Barbeque Poppers'), findsOneWidget);
      expect(find.text('Korean Yangnyeom Poppers'), findsOneWidget);
      expect(find.text('Lemon Glaze Poppers'), findsOneWidget);
      expect(find.text('Teriyaki Gloss Poppers'), findsOneWidget);
      expect(find.text('Creamy Cheese Poppers'), findsOneWidget);
      expect(find.text('Mango Habanero Poppers'), findsOneWidget);
    },
  );
}
