// Evidence harness, not shipped: the real KdsPage wired to the Firebase
// emulators (demo project) and signed in as staff, so tool/kds_live_probe.mjs
// can screenshot the live kitchen screen and time order-to-screen latency.
//
//   flutter build web -t tool/kds_live_preview.dart --output <dir>
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/screens/kds_page.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/session.dart';

const _host = '127.0.0.1';

/// Created with role=staff by tool/kds_live_probe.mjs on the Auth emulator.
const _staffEmail = 'staff@kds.test';
const _staffPassword = 'kds-probe-only';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // DOM semantics nodes let the probe read on-screen order names.
  SemanticsBinding.instance.ensureSemantics();
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
  await FirebaseAuth.instance.signInWithEmailAndPassword(
    email: _staffEmail,
    password: _staffPassword,
  );

  session.login('staff_tester');
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: session),
        ChangeNotifierProvider.value(value: kioskSession),
        ChangeNotifierProvider.value(value: cartNotifier),
      ],
      child: const MaterialApp(
        debugShowCheckedModeBanner: false,
        home: KdsPage(),
      ),
    ),
  );
}
