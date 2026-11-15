import 'dart:async';

import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import '../firebase_options.dart';

Completer<void>? _firebaseCompleter;
bool _appCheckActivated = false;
bool _deferredStartupEnabled = false;

/// Arms deferred Firebase startup from `main()`. When `main()` has not run
/// (such as isolated widget tests under `FakeAsync`), callers proceed immediately
/// without hanging on platform-channel initialization.
void startDeferredFirebaseInit({VoidCallback? onReady}) {
  _deferredStartupEnabled = true;
  ensureFirebaseInitialized().then(
    (_) => onReady?.call(),
    onError: (Object e) {
      debugPrint('Deferred Firebase init failed: $e');
    },
  );
}

/// Ensures Firebase Core is initialized and App Check activation is started.
/// Allows `runApp` to paint the first frame without waiting on Firebase init.
Future<void> ensureFirebaseInitialized() {
  if (!_deferredStartupEnabled && Firebase.apps.isEmpty) {
    return Future<void>.value();
  }
  if (_firebaseCompleter != null) return _firebaseCompleter!.future;
  final completer = _firebaseCompleter = Completer<void>();
  _initialize().then(
    completer.complete,
    onError: (Object error, StackTrace stackTrace) {
      _firebaseCompleter = null;
      completer.completeError(error, stackTrace);
    },
  );
  return completer.future;
}

Future<void> _initialize() async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }
  if (!_appCheckActivated) {
    _appCheckActivated = true;
    unawaited(_activateAppCheck());
  }
}

/// #12 bot protection: Firebase App Check (reCAPTCHA Enterprise on web).
/// Site key is injected at build time so it never lands in git:
///   `flutter build web --dart-define=RECAPTCHA_SITE_KEY=<key>`
/// Until the key is set, activation is skipped (requests still work).
Future<void> _activateAppCheck() async {
  const siteKey = String.fromEnvironment('RECAPTCHA_SITE_KEY');
  try {
    if (kDebugMode) {
      await FirebaseAppCheck.instance.activate(
        providerAndroid: const AndroidDebugProvider(),
        providerApple: const AppleDebugProvider(),
      );
    } else if (siteKey.isNotEmpty) {
      await FirebaseAppCheck.instance.activate(
        providerAndroid: const AndroidPlayIntegrityProvider(),
        providerApple: const AppleAppAttestProvider(),
        providerWeb: ReCaptchaEnterpriseProvider(siteKey),
      );
    } else {
      debugPrint('AppCheck skipped: no RECAPTCHA_SITE_KEY defined');
    }
  } catch (e) {
    debugPrint('AppCheck activation failed: $e');
  }
}
