import 'package:flutter/material.dart';

/// Colours and type from the design reference: navy and white do the work;
/// blue is your side, green is theirs, amber while the money travels, red if refused.
abstract final class DemoColours {
  static const ink = Color(0xFF0D2252);
  static const ink2 = Color(0xFF5B6785);
  static const line = Color(0xFFE2E7F1);
  static const fog = Color(0xFFF2F5FB);
  static const white = Color(0xFFFFFFFF);
  static const ok = Color(0xFF1C7F57);
  static const okSoft = Color(0xFFE1F3EA);
  static const wait = Color(0xFF9A5B00);
  static const waitSoft = Color(0xFFFDF0D8);
  static const bad = Color(0xFFC2362B);
  static const badSoft = Color(0xFFFBE6E3);
  static const go = Color(0xFF3346D3);
  static const goSoft = Color(0xFFE7E9FB);
  static const marigold = Color(0xFFF5A623);
  static const blue = Color(0xFF2563D9);
  static const blueSoft = Color(0xFFE6EEFC);
  static const paid = Color(0xFF1F8A5B);
  static const refused = Color(0xFFD2382F);
}

abstract final class DemoText {
  /// The condensed "departure board" face for amounts and routes. (The design uses
  /// Big Shoulders; the demo uses the condensed fonts a device already has.)
  static const display = TextStyle(
    fontFamilyFallback: [
      'Big Shoulders Display',
      'Arial Narrow',
      'Roboto Condensed',
      'Impact',
    ],
    fontWeight: FontWeight.w900,
    letterSpacing: -0.5,
    color: DemoColours.ink,
  );
}

ThemeData demoTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: DemoColours.blue,
    brightness: Brightness.light,
    primary: DemoColours.ink,
    onPrimary: DemoColours.white,
    surface: DemoColours.white,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: DemoColours.fog,
    appBarTheme: const AppBarTheme(
      backgroundColor: DemoColours.fog,
      foregroundColor: DemoColours.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: DemoColours.ink,
        foregroundColor: DemoColours.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: DemoColours.ink,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: DemoColours.ink, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: DemoColours.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: DemoColours.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: DemoColours.line),
      ),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: DemoColours.white,
      indicatorColor: DemoColours.blueSoft,
    ),
  );
}
