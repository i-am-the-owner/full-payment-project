import 'package:flutter/foundation.dart';

import 'app_environment.dart';

/// Immutable, build-time application configuration.
///
/// This holds only non-sensitive values (the backend base URL, display name).
/// Wise credentials, signing keys and other secrets never live in the mobile
/// app — all privileged calls go through the AaminPay backend.
///
/// The `*.sompay.example` hosts below are placeholders: real backend hostnames
/// are wired in once the environments are provisioned.
@immutable
class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.appDisplayName,
    this.supportEmail = 'support@sompay.example',
  });

  /// Builds the configuration for the given [environment].
  ///
  /// Staging and production hosts are set per build with
  /// `--dart-define=ALMAPAY_API_URL=https://...` (the built-in `.example` hosts
  /// are placeholders). A release build refuses a placeholder, a non-https URL or
  /// a missing one, so it can never ship pointing nowhere or in cleartext.
  factory AppConfig.forEnvironment(
    AppEnvironment environment, {
    String apiUrlOverride = const String.fromEnvironment('ALMAPAY_API_URL'),
    bool isReleaseMode = kReleaseMode,
  }) {
    final base = AppConfig._defaults(environment);
    if (environment == AppEnvironment.demo) {
      return base; // No backend: the address is a placeholder nothing connects to.
    }
    if (apiUrlOverride.isEmpty) {
      if (isReleaseMode && environment != AppEnvironment.development) {
        _requireRealHost(base.apiBaseUrl);
      }
      return base;
    }
    final url = Uri.parse(apiUrlOverride);
    if (environment != AppEnvironment.development) {
      _requireRealHost(url);
    }
    return AppConfig(
      environment: environment,
      apiBaseUrl: url,
      appDisplayName: base.appDisplayName,
    );
  }

  static void _requireRealHost(Uri url) {
    if (url.scheme != 'https' ||
        url.host.endsWith('.example') ||
        url.host.isEmpty) {
      throw StateError(
        'The API URL must be a real https:// host (got $url). Set '
        '--dart-define=ALMAPAY_API_URL=https://your-api-host for this build.',
      );
    }
  }

  factory AppConfig._defaults(AppEnvironment environment) {
    return switch (environment) {
      AppEnvironment.development => AppConfig(
        environment: environment,
        // 10.0.2.2 is the Android emulator's alias for the host machine.
        apiBaseUrl: Uri.parse('http://10.0.2.2:3000'),
        appDisplayName: 'AaminPay (Dev)',
      ),
      AppEnvironment.staging => AppConfig(
        environment: environment,
        apiBaseUrl: Uri.parse('https://staging.api.sompay.example'),
        appDisplayName: 'AaminPay (Staging)',
      ),
      AppEnvironment.demo => AppConfig(
        environment: environment,
        // `.invalid` can never resolve (RFC 2606): even by mistake nothing is reached.
        apiBaseUrl: Uri.parse('https://demo.invalid'),
        appDisplayName: 'AaminPay Demo',
      ),
      AppEnvironment.production => AppConfig(
        environment: environment,
        apiBaseUrl: Uri.parse('https://api.sompay.example'),
        appDisplayName: 'AaminPay',
      ),
    };
  }

  final AppEnvironment environment;
  final Uri apiBaseUrl;
  final String appDisplayName;

  /// Where customers are told to write for help. A placeholder, like the hosts
  /// above, until the real support address exists.
  final String supportEmail;

  bool get isProduction => environment.isProduction;

  @override
  bool operator ==(Object other) =>
      other is AppConfig &&
      other.environment == environment &&
      other.apiBaseUrl == apiBaseUrl &&
      other.appDisplayName == appDisplayName;

  @override
  int get hashCode => Object.hash(environment, apiBaseUrl, appDisplayName);
}
