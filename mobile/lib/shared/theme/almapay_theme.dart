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
  );

  /// The quiet sans (Geist) used for everything else.
  static TextStyle ui({double size = 16, int weight = 400, Color? color}) =>
      TextStyle(
        fontFamily: 'Geist',
        fontVariations: [FontVariation('wght', weight.toDouble())],
        fontWeight: FontWeight.values[(weight ~/ 100) - 1],
        fontSize: size,
        color: color,
      );
}

/// The colours that change between the light and the dark design. Read with
/// `context.palette`; the fixed brand colours stay in [AlmaPayColours].
@immutable
class AlmaPayPalette extends ThemeExtension<AlmaPayPalette> {
  const AlmaPayPalette({
    required this.background,
    required this.surface,
    required this.text,
    required this.muted,
    required this.line,
    required this.accent,
    required this.accentSoft,
    required this.primary,
    required this.onPrimary,
  });

  final Color background;
  final Color surface;
  final Color text;
  final Color muted;
  final Color line;

  /// Blue for links, selection and the active tab.
  final Color accent;
  final Color accentSoft;

  /// Filled buttons.
  final Color primary;
  final Color onPrimary;

  static const light = AlmaPayPalette(
    background: AlmaPayColours.fog,
    surface: AlmaPayColours.white,
    text: AlmaPayColours.ink,
    muted: AlmaPayColours.ink2,
    line: AlmaPayColours.line,
    accent: AlmaPayColours.blue,
    accentSoft: AlmaPayColours.blueSoft,
    primary: AlmaPayColours.ink,
    onPrimary: AlmaPayColours.white,
  );

  static const dark = AlmaPayPalette(
    background: Color(0xFF0A1226),
    surface: Color(0xFF141E38),
    text: Color(0xFFEAF0FF),
    muted: Color(0xFF9AA8C7),
    line: Color(0xFF26335A),
    accent: Color(0xFF6B9BFF),
    accentSoft: Color(0xFF1B2A52),
    primary: Color(0xFF3B74F0),
    onPrimary: AlmaPayColours.white,
  );

  @override
  AlmaPayPalette copyWith() => this;

  @override
  AlmaPayPalette lerp(ThemeExtension<AlmaPayPalette>? other, double t) =>
      t < 0.5 || other is! AlmaPayPalette ? this : other;
}

extension AlmaPayContext on BuildContext {
  AlmaPayPalette get palette =>
      Theme.of(this).extension<AlmaPayPalette>() ?? AlmaPayPalette.light;
}

/// Central theme definition for AaminPay, in a light and a dark design.
abstract final class AlmaPayTheme {
  static ThemeData light() => _base(AlmaPayPalette.light, Brightness.light);

  static ThemeData dark() => _base(AlmaPayPalette.dark, Brightness.dark);

  static ThemeData _base(AlmaPayPalette p, Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: AlmaPayColours.blue,
      brightness: brightness,
      primary: p.primary,
      onPrimary: p.onPrimary,
      surface: p.surface,
      onSurface: p.text,
      error: AlmaPayColours.bad,
    );
    final pill = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(29),
    );
    final buttonText = AlmaPayText.ui(size: 17, weight: 600);
    final fieldBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(
        color: brightness == Brightness.dark
            ? p.line
            : AlmaPayColours.fieldLine,
        width: 1.5,
      ),
    );
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: 'Geist',
      brightness: brightness,
      extensions: [p],
    );

    return base.copyWith(
      scaffoldBackgroundColor: p.background,
      textTheme: base.textTheme.apply(bodyColor: p.text, displayColor: p.text),
      appBarTheme: AppBarTheme(
        backgroundColor: p.background,
        foregroundColor: p.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: AlmaPayText.ui(size: 17, weight: 600, color: p.text),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: p.primary,
          foregroundColor: p.onPrimary,
          minimumSize: const Size.fromHeight(58),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: p.text,
          backgroundColor: p.surface,
          minimumSize: const Size.fromHeight(58),
          side: BorderSide(color: p.line, width: 1.5),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: p.text,
          textStyle: AlmaPayText.ui(size: 16, weight: 600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: p.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 18,
        ),
        floatingLabelStyle: AlmaPayText.ui(
          size: 14,
          weight: 500,
          color: p.muted,
        ),
        labelStyle: AlmaPayText.ui(size: 16, color: p.muted),
        prefixIconColor: p.muted,
        suffixIconColor: p.muted,
        border: fieldBorder,
        enabledBorder: fieldBorder,
        focusedBorder: fieldBorder.copyWith(
          borderSide: BorderSide(color: p.accent, width: 2),
        ),
      ),
      cardTheme: CardThemeData(
        color: p.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      dividerTheme: DividerThemeData(color: p.line, thickness: 1, space: 1),
      checkboxTheme: CheckboxThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.primary : null,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: p.surface,
        indicatorColor: Colors.transparent,
        elevation: 0,
        height: 72,
        iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(
            size: 26,
            color: s.contains(WidgetState.selected)
                ? p.accent
                : AlmaPayColours.faint,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (s) => AlmaPayText.ui(
            size: 11,
            weight: 600,
            color: s.contains(WidgetState.selected)
                ? p.accent
                : AlmaPayColours.faint,
          ),
        ),
      ),
      listTileTheme: ListTileThemeData(iconColor: p.muted, textColor: p.text),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: brightness == Brightness.dark
            ? p.accentSoft
            : AlmaPayColours.ink,
        contentTextStyle: AlmaPayText.ui(
          color: brightness == Brightness.dark ? p.text : AlmaPayColours.white,
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
