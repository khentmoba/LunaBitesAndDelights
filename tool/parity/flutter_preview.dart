// Evidence harness, not shipped: the real Flutter app wired to the Firebase
// emulators (demo project) so tool/parity/shoot.mjs can capture every screen
// as the baseline the TypeScript rewrite is compared against.
//
//   flutter build web --release -t tool/parity/flutter_preview.dart --output <dir>
//
// Query parameters (read before the hash route):
//   staff=1      sign in as the seeded staff account
//   cart=1       start with two items in the cart
//   push=receipt|gcash   push a screen that needs constructor arguments
//   push=checkout        push checkout once the staff session is bound (POS)
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/main.dart';
import 'package:luna_bites_and_delights/models/cart.dart';
import 'package:luna_bites_and_delights/screens/checkout_page.dart';
import 'package:luna_bites_and_delights/screens/gcash_checkout_page.dart';
import 'package:luna_bites_and_delights/screens/receipt_page.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/firebase_init.dart';
import 'package:luna_bites_and_delights/services/navigation.dart';
import 'package:luna_bites_and_delights/services/session.dart';

const _host = '127.0.0.1';

/// Created by tool/parity/shoot.mjs on the Auth emulator.
const _staffEmail = 'staff@parity.test';
const _staffPassword = 'parity-only';

List<CartItem> _sampleItems() => [
  CartItem(
    id: 'sm3',
    name: 'S3 – Shawarma Rice',
    emoji: '🌯🍚',
    imageUrl: 'images/sulit_shawarma.webp',
    variant: '',
    price: 99,
    quantity: 2,
  ),
  CartItem(
    id: 'mc1',
    name: 'Milo Craze',
    emoji: '🥤',
    imageUrl: '',
    variant: 'Oreo',
    price: 65,
  ),
];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final q = Uri.base.queryParameters;
  await Firebase.initializeApp(
    options: const FirebaseOptions(
      apiKey: 'demo-key',
      appId: '1:1:web:1',
      messagingSenderId: '1',
      projectId: 'demo-lunaexpress',
    ),
  );
  FirebaseFirestore.instance.useFirestoreEmulator(_host, 8080);
  FirebaseFunctions.instanceFor(
    region: 'us-central1',
  ).useFunctionsEmulator(_host, 5001);
  await FirebaseAuth.instance.useAuthEmulator(_host, 9099);
  if (q['staff'] == '1') {
    await FirebaseAuth.instance.signInWithEmailAndPassword(
      email: _staffEmail,
      password: _staffPassword,
    );
  } else {
    await FirebaseAuth.instance.signOut();
  }
  if (q['cart'] == '1') {
    for (final item in _sampleItems()) {
      cartNotifier.add(item);
    }
  }

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: session),
        ChangeNotifierProvider.value(value: kioskSession),
        ChangeNotifierProvider.value(value: cartNotifier),
      ],
      child: const LunaExpressApp(),
    ),
  );
  WidgetsBinding.instance.addPostFrameCallback((_) {
    startDeferredFirebaseInit(onReady: session.bindAuth);
    final push = q['push'];
    if (push != null) unawaited(_push(push));
  });
}

Future<void> _push(String screen) async {
  await Future<void>.delayed(const Duration(milliseconds: 300));
  if (screen == 'checkout') {
    // CheckoutPage reads session.isStaff once, as staff reach it from the menu.
    for (var i = 0; i < 100 && !session.isStaff; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
  }
  final nav = appRouteObserver.navigator;
  if (nav == null) return;
  final items = _sampleItems();
  final total = items.fold(0, (s, i) => s + i.price * i.quantity);
  final Widget page = switch (screen) {
    'receipt' => ReceiptPage(
      orderNumber: 'LU-261115-001',
      customerName: 'Ana Reyes',
      customerAddress: 'Purok 5, Poblacion Magallanes',
      customerPhone: '09171234567',
      items: items,
      total: total,
      timeStr: 'Nov 15, 2026 · 12:30 PM',
      isWalkIn: false,
      orderType: 'Delivery',
    ),
    'gcash' => GCashCheckoutPage(
      orderDocId: 'parity-order',
      orderId: 'LU-261115-001',
      amount: total,
      items: [
        for (final i in items)
          {'name': i.name, 'price': i.price, 'quantity': i.quantity},
      ],
      customerName: 'Ana Reyes',
      customerPhone: '09171234567',
      webCheckoutOverride: true,
      callFunction: (name, [payload]) async => {
        'checkoutUrl': 'https://checkout.paymongo.com/cs_parity',
        'checkoutSessionId': 'cs_parity',
      },
    ),
    'checkout' => const CheckoutPage(),
    _ => throw ArgumentError('unknown push screen: $screen'),
  };
  unawaited(nav.push(MaterialPageRoute<void>(builder: (_) => page)));
}
