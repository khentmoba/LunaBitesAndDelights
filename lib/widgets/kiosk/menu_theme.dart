import 'package:flutter/material.dart';

/// The pink order pad: white slips on the blush carbon copy, printed in logo
/// pink, highlighted in butter yellow and written in plum ink.
class MenuTheme {
  /// Blush carbon copy behind every sheet.
  static const ground = Color(0xFFFEB7C9);

  /// The order slip itself.
  static const paper = Color(0xFFFFFAFB);

  /// A photo card or raised slip on paper.
  static const card = Color(0xFFFFFFFF);

  /// Selected rows and printed notice boxes.
  static const blushPaper = Color(0xFFFFF0F4);

  /// Printed ruling between lines and around cards.
  static const rule = Color(0xFFF4AFC8);

  /// Logo pink, for rules, large type and the logo's own world.
  static const pink = Color(0xFFEC1C72);

  /// Pink small type and icons on paper (6.5:1).
  static const pinkInk = Color(0xFFB30E52);

  /// Type-bearing pink surfaces: buttons, bands, selected choices (white 4.9:1).
  static const plate = Color(0xFFD91566);

  /// Type on [plate].
  static const onPlate = Color(0xFFFFFFFF);

  /// Highlighter and tape.
  static const butter = Color(0xFFFCD04E);

  /// Plum-black ink for all reading text (17:1 on paper).
  static const ink = Color(0xFF2A0F1E);

  /// Secondary text (8.6:1 on paper).
  static const inkSoft = Color(0xFF6B3A52);

  static const printFamily = 'Bricolage';
  static const handFamily = 'Caveat';

  static TextStyle heading(double size, {Color color = ink}) => TextStyle(
    fontFamily: printFamily,
    fontSize: size,
    fontWeight: FontWeight.w800,
    height: 1.02,
    letterSpacing: -size * .02,
    color: color,
  );

  static TextStyle body({double size = 16, Color color = ink}) => TextStyle(
    fontFamily: printFamily,
    fontSize: size,
    height: 1.4,
    color: color,
  );

  /// The cashier's handwriting, only for marks written onto the slip.
  static TextStyle hand({double size = 22, Color color = ink}) => TextStyle(
    fontFamily: handFamily,
    fontSize: size,
    fontWeight: FontWeight.w600,
    height: 1.1,
    color: color,
  );

  /// Printed form labels: small uppercase pink.
  static TextStyle label({double size = 12, Color color = pinkInk}) =>
      TextStyle(
        fontFamily: printFamily,
        fontSize: size,
        fontWeight: FontWeight.w700,
        letterSpacing: size * .14,
        height: 1.2,
        color: color,
      );

  static TextStyle price({double size = 18, Color color = ink}) => TextStyle(
    fontFamily: printFamily,
    fontSize: size,
    fontWeight: FontWeight.w800,
    height: 1,
    color: color,
    fontFeatures: const [FontFeature.tabularFigures()],
  );

  static const radius = BorderRadius.all(Radius.circular(6));

  static ThemeData get data => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    fontFamily: printFamily,
    scaffoldBackgroundColor: ground,
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: plate,
      selectionColor: butter.withValues(alpha: .6),
      selectionHandleColor: plate,
    ),
    colorScheme: const ColorScheme.light(
      primary: plate,
      onPrimary: onPlate,
      secondary: pinkInk,
      onSecondary: onPlate,
      surface: paper,
      onSurface: ink,
      onSurfaceVariant: inkSoft,
      outline: pinkInk,
      outlineVariant: rule,
      error: Color(0xFFB3261E),
    ),
    dividerColor: rule,
    focusColor: pink.withValues(alpha: .16),
    hoverColor: pink.withValues(alpha: .06),
    iconTheme: const IconThemeData(color: pinkInk),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(48, 48),
        foregroundColor: pinkInk,
        shape: const RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: plate,
        foregroundColor: onPlate,
        disabledBackgroundColor: blushPaper,
        disabledForegroundColor: inkSoft,
        minimumSize: const Size(48, 52),
        shape: const RoundedRectangleBorder(borderRadius: radius),
        textStyle: body(size: 16).copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: pinkInk,
        minimumSize: const Size(48, 48),
        side: const BorderSide(color: pinkInk, width: 2),
        shape: const RoundedRectangleBorder(borderRadius: radius),
        textStyle: body(size: 15).copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: paper,
      shape: const RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: rule),
      ),
      textStyle: body(size: 14),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: paper,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(10)),
      ),
    ),
    badgeTheme: const BadgeThemeData(
      backgroundColor: plate,
      textColor: onPlate,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: ink,
      contentTextStyle: body(size: 14, color: paper),
    ),
  );

  static IconData categoryIcon(String id) => switch (id) {
    'sulit_meals' => Icons.rice_bowl_outlined,
    'chicken_poppers' => Icons.restaurant_outlined,
    'shawarma' => Icons.lunch_dining_outlined,
    'fries' => Icons.fastfood_outlined,
    'combos' => Icons.dinner_dining_outlined,
    'extras' => Icons.add_circle_outline,
    'drinks' => Icons.local_drink_outlined,
    'burger_hotdog_combined' => Icons.lunch_dining_outlined,
    _ => Icons.restaurant_menu,
  };
}
