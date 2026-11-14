import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter/foundation.dart';
import 'firebase_options.dart';
import 'widgets/kiosk/kiosk_theme.dart';
import 'services/session.dart';
import 'services/cart_notifier.dart';
import 'screens/splash_screen.dart';
import 'screens/menu_page.dart';
import 'screens/cart_page.dart';
import 'screens/checkout_page.dart';
import 'screens/staff_screens.dart';

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

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await _activateAppCheck();

  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarIconBrightness: Brightness.dark,
      systemNavigationBarDividerColor: Colors.transparent,
    ),
  );

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
}

class LunaExpressApp extends StatelessWidget {
  const LunaExpressApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Luna Bites & Delights',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        visualDensity: VisualDensity.adaptivePlatformDensity,
        pageTransitionsTheme: const PageTransitionsTheme(
          builders: {
            TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
            TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
            TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
          },
        ),
        colorScheme: ColorScheme.fromSeed(
          seedColor: KioskTheme.lunaPink,
          brightness: Brightness.light,
          primary: KioskTheme.lunaPink,
          onPrimary: KioskTheme.textOnPrimary,
          secondary: KioskTheme.pinkInk,
          tertiary: KioskTheme.lunaButter,
          surface: KioskTheme.lunaPaper,
          onSurface: KioskTheme.textPrimary,
          outline: KioskTheme.pinkInk,
          outlineVariant: KioskTheme.rule,
          error: KioskTheme.error,
        ),
        scaffoldBackgroundColor: KioskTheme.lunaBlushPaper,
        fontFamily: KioskTheme.printFamily,
        textSelectionTheme: TextSelectionThemeData(
          cursorColor: KioskTheme.lunaPink,
          selectionColor: KioskTheme.lunaButter.withValues(alpha: .6),
          selectionHandleColor: KioskTheme.lunaPink,
        ),
        appBarTheme: AppBarTheme(
          centerTitle: true,
          elevation: 0,
          scrolledUnderElevation: 2,
          backgroundColor: KioskTheme.lunaPaper,
          foregroundColor: KioskTheme.textPrimary,
          surfaceTintColor: Colors.transparent,
          titleTextStyle: KioskTheme.headerSmall,
          shape: const Border(
            bottom: BorderSide(color: KioskTheme.lunaLogoPink, width: 2),
          ),
        ),
        cardTheme: CardThemeData(
          elevation: 0,
          color: KioskTheme.lunaWhite,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
            side: const BorderSide(color: KioskTheme.rule),
          ),
        ),
        dividerTheme: const DividerThemeData(color: KioskTheme.rule),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: KioskTheme.lunaPink,
            foregroundColor: KioskTheme.textOnPrimary,
            minimumSize: const Size(48, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
            ),
          ),
        ),
        snackBarTheme: SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: KioskTheme.lunaInk,
          contentTextStyle: KioskTheme.font(
            color: KioskTheme.lunaPaper,
            fontSize: 14,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
          ),
        ),
      ),
      initialRoute: '/',
      routes: {
        '/': (context) => const KioskSplashScreen(),
        '/menu': (context) => const KioskMenuPage(),
        '/cart': (context) => const KioskCartPage(),
        '/checkout_process': (context) => const CheckoutPage(),
        // Staff screens load on demand (separate JS part on web).
        '/kds': (context) => const DeferredStaffScreen(StaffScreen.kds),
        '/staff': (context) => const DeferredStaffScreen(StaffScreen.kds),
        '/orders': (context) => const DeferredStaffScreen(StaffScreen.kds),
        '/dashboard': (context) =>
            const DeferredStaffScreen(StaffScreen.dashboard),
        '/analytics': (context) =>
            const DeferredStaffScreen(StaffScreen.analytics),
        '/lifetime-analytics': (context) =>
            const DeferredStaffScreen(StaffScreen.lifetimeAnalytics),
      },
    );
  }
}
