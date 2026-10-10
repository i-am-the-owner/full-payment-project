import 'package:flutter/foundation.dart' show kReleaseMode;

/// The deployment environment the mobile app is built for.
///
/// Selected at build time with `--dart-define=ALMAPAY_ENV=<value>`. Defaults to
/// [AppEnvironment.development] so local runs need no extra flags. There is no
/// mechanism to change the environment at runtime: a build targets exactly one.
enum AppEnvironment {
  development,
  staging,
  production,

  /// A self-contained demo with sample data and NO backend: it never makes a
  /// network call. It is built only through `lib/main_demo.dart`; the real app's
  /// entry point (`lib/main.dart`) refuses it, and a release build of the demo is
  /// allowed only for the demo workflows (see [resolveDemo]).
  demo;

  static const String dartDefineKey = 'ALMAPAY_ENV';

  /// Parses an environment from its [name], throwing [ArgumentError] if unknown.
  static AppEnvironment fromName(String value) {
    for (final environment in AppEnvironment.values) {
      if (environment.name == value) {
        return environment;
      }
    }
    throw ArgumentError.value(value, 'value', 'Unknown AaminPay environment');
  }

  /// Resolves the environment from the compile-time configuration.
  ///
  /// A debug or profile build without the flag is `development`. A RELEASE build
  /// without it is refused: it would otherwise talk to a cleartext localhost URL.
  ///
  /// This is the REAL app's resolver: it refuses `demo` in every build mode.
  static AppEnvironment resolve() {
    const raw = String.fromEnvironment(dartDefineKey);
    return resolveFrom(raw, isReleaseMode: kReleaseMode);
  }

  /// The demo entry point's resolver (`lib/main_demo.dart`). It accepts only
  /// `ALMAPAY_ENV=demo`. In a RELEASE build it also needs
  /// `--dart-define=ALMAPAY_DEMO_RELEASE=true`, which only the demo workflows
  /// set, so an ordinary release build can never turn into a demo.
  static AppEnvironment resolveDemo() {
    const raw = String.fromEnvironment(dartDefineKey);
    const allowRelease = bool.fromEnvironment('ALMAPAY_DEMO_RELEASE');
    return resolveDemoFrom(
      raw,
      isReleaseMode: kReleaseMode,
      allowDemoRelease: allowRelease,
    );
  }

  /// [resolveDemo] with its inputs passed in, so it can be tested.
  static AppEnvironment resolveDemoFrom(
    String raw, {
    required bool isReleaseMode,
    required bool allowDemoRelease,
  }) {
    if (raw != 'demo') {
      throw StateError(
        'The demo app needs --dart-define=ALMAPAY_ENV=demo (got "$raw").',
      );
    }
    if (isReleaseMode && !allowDemoRelease) {
      throw StateError(
        'A release build cannot be the demo. The demo workflows pass '
        '--dart-define=ALMAPAY_DEMO_RELEASE=true; nothing else should.',
      );
    }
    return AppEnvironment.demo;
  }

  /// [resolve] with its inputs passed in, so it can be tested.
  static AppEnvironment resolveFrom(String raw, {required bool isReleaseMode}) {
    if (raw.isEmpty) {
      if (isReleaseMode) {
        throw StateError(
          'This is a release build but ALMAPAY_ENV is not set. Build with '
          '--dart-define=ALMAPAY_ENV=staging or production.',
        );
      }
      return AppEnvironment.development;
    }
    final environment = fromName(raw);
    if (environment == AppEnvironment.demo) {
      throw StateError(
        'The real app cannot run as the demo. Build the demo with '
        '-t lib/main_demo.dart (see docs/demo/README.md).',
      );
    }
    if (isReleaseMode && environment == AppEnvironment.development) {
      throw StateError(
        'A release build cannot use the development environment.',
      );
    }
    return environment;
  }

  bool get isProduction => this == AppEnvironment.production;
}
