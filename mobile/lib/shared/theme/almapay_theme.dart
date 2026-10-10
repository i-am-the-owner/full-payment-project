import 'package:flutter/material.dart';

/// Brand colours from `aaminpay-design-reference.html`: blue, dark blue and
/// white do the work. Blue is your side, green is theirs, amber while the money
/// travels, red if it is refused.
abstract final class AlmaPayColours {
  static const ink = Color(0xFF0D2252);
  static const ink2 = Color(0xFF5B6785);
  static const line = Color(0xFFE2E7F1);
  static const fog = Color(0xFFF2F5FB);
  static const white = Color(0xFFFFFFFF);
  static const blue = Color(0xFF2563D9);
  static const blueSoft = Color(0xFFE6EEFC);
  static const paid = Color(0xFF1A7F53);
  static const way = Color(0xFFF5A623);
  static const refused = Color(0xFFD2382F);
  static const ok = Color(0xFF1C7F57);
  static const okSoft = Color(0xFFE1F3EA);
  static const wait = Color(0xFF9A5B00);
  static const waitSoft = Color(0xFFFDF0D8);
  static const bad = Color(0xFFC2362B);
  static const badSoft = Color(0xFFFBE6E3);

  /// The outline of a text field.
  static const fieldLine = Color(0xFFCFCED6);

  /// The unselected radio ring and the "not yet" step.
  static const faint = Color(0xFF9AA5BD);
}

abstract final class AlmaPayText {
  /// The condensed "departure board" face (Big Shoulders Display 800) for
  /// headlines, amounts and routes.
  static const display = TextStyle(
    fontFamily: 'BigShouldersDisplay',
    fontVariations: [FontVariation('wght', 800)],
    fontWeight: FontWeight.w800,
    letterSpacing: 0.3,
    height: 0.95,
    color: AlmaPayColours.ink,
  );

  /// The quiet sans (Geist) used for everything else.
  static TextStyle ui({
    double size = 16,
    int weight = 400,
    Color color = AlmaPayColours.ink,
  }) => TextStyle(
    fontFamily: 'Geist',
    fontVariations: [FontVariation('wght', weight.toDouble())],
    fontWeight: FontWeight.values[(weight ~/ 100) - 1],
    fontSize: size,
    color: color,
  );
}

/// Central theme definition for AaminPay. The design is always light.
abstract final class AlmaPayTheme {
  static ThemeData light() => _base();

  /// The design has no dark variant, so dark mode shows the same theme.
  static ThemeData dark() => _base();

  static ThemeData _base() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AlmaPayColours.blue,
      brightness: Brightness.light,
      primary: AlmaPayColours.ink,
      onPrimary: AlmaPayColours.white,
      surface: AlmaPayColours.white,
      error: AlmaPayColours.bad,
    );
    final pill = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(29),
    );
    final buttonText = AlmaPayText.ui(size: 17, weight: 600);
    final fieldBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: AlmaPayColours.fieldLine, width: 1.5),
    );
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: 'Geist',
    );

    return base.copyWith(
      scaffoldBackgroundColor: AlmaPayColours.fog,
      textTheme: base.textTheme.apply(
        bodyColor: AlmaPayColours.ink,
        displayColor: AlmaPayColours.ink,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AlmaPayColours.fog,
        foregroundColor: AlmaPayColours.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: AlmaPayText.ui(size: 17, weight: 600),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AlmaPayColours.ink,
          foregroundColor: AlmaPayColours.white,
          minimumSize: const Size.fromHeight(58),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AlmaPayColours.ink,
          backgroundColor: AlmaPayColours.white,
          minimumSize: const Size.fromHeight(58),
          side: const BorderSide(color: AlmaPayColours.line, width: 1.5),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AlmaPayColours.ink,
          textStyle: AlmaPayText.ui(size: 16, weight: 600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AlmaPayColours.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 18,
        ),
        floatingLabelStyle: AlmaPayText.ui(
          size: 14,
          weight: 500,
          color: AlmaPayColours.ink2,
        ),
        labelStyle: AlmaPayText.ui(size: 16, color: AlmaPayColours.ink2),
        prefixIconColor: AlmaPayColours.ink2,
        suffixIconColor: AlmaPayColours.ink2,
        border: fieldBorder,
        enabledBorder: fieldBorder,
        focusedBorder: fieldBorder.copyWith(
          borderSide: const BorderSide(color: AlmaPayColours.blue, width: 2),
        ),
      ),
      cardTheme: CardThemeData(
        color: AlmaPayColours.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      dividerTheme: const DividerThemeData(
        color: AlmaPayColours.line,
        thickness: 1,
        space: 1,
      ),
      checkboxTheme: CheckboxThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? AlmaPayColours.ink : null,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AlmaPayColours.white,
        indicatorColor: Colors.transparent,
        elevation: 0,
        height: 72,
        iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(
            size: 26,
            color: s.contains(WidgetState.selected)
                ? AlmaPayColours.blue
                : AlmaPayColours.faint,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (s) => AlmaPayText.ui(
            size: 11,
            weight: 600,
            color: s.contains(WidgetState.selected)
                ? AlmaPayColours.blue
                : AlmaPayColours.faint,
          ),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AlmaPayColours.ink,
        contentTextStyle: AlmaPayText.ui(color: AlmaPayColours.white),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
