import 'package:almapay/app/environment/app_config.dart';
import 'package:almapay/app/environment/app_environment.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  apiUrlTests();
  group('AppConfig.forEnvironment', () {
    test('development points at the emulator host loopback over http', () {
      final config = AppConfig.forEnvironment(AppEnvironment.development);

      expect(config.environment, AppEnvironment.development);
      expect(config.apiBaseUrl, Uri.parse('http://10.0.2.2:3000'));
      expect(config.isProduction, isFalse);
    });

    test('staging and production use https', () {
      expect(
        AppConfig.forEnvironment(AppEnvironment.staging).apiBaseUrl.scheme,
        'https',
      );
      expect(
        AppConfig.forEnvironment(AppEnvironment.production).apiBaseUrl.scheme,
        'https',
      );
    });

    test('production has no environment suffix in its display name', () {
      final config = AppConfig.forEnvironment(AppEnvironment.production);

      expect(config.appDisplayName, 'AaminPay');
      expect(config.isProduction, isTrue);
    });

    test('value equality holds for identical configurations', () {
      expect(
        AppConfig.forEnvironment(AppEnvironment.staging),
        AppConfig.forEnvironment(AppEnvironment.staging),
      );
      expect(
        AppConfig.forEnvironment(AppEnvironment.staging),
        isNot(AppConfig.forEnvironment(AppEnvironment.production)),
      );
    });
  });
}

void apiUrlTests() {
  group('API URL per build', () {
    test('a release build refuses the .example placeholder hosts', () {
      for (final env in [AppEnvironment.staging, AppEnvironment.production]) {
        expect(
          () => AppConfig.forEnvironment(env, isReleaseMode: true),
          throwsStateError,
        );
      }
    });

    test('ALMAPAY_API_URL sets the host; it must be real https outside development', () {
      final config = AppConfig.forEnvironment(
        AppEnvironment.production,
        apiUrlOverride: 'https://api.almapay.com',
        isReleaseMode: true,
      );
      expect(config.apiBaseUrl, Uri.parse('https://api.almapay.com'));
      for (final bad in [
        'http://api.almapay.com',
        'https://api.almapay.example',
      ]) {
        expect(
          () => AppConfig.forEnvironment(
            AppEnvironment.production,
            apiUrlOverride: bad,
          ),
          throwsStateError,
          reason: bad,
        );
      }
    });

    test('debug builds keep the defaults', () {
      expect(
        AppConfig.forEnvironment(
          AppEnvironment.staging,
          isReleaseMode: false,
        ).apiBaseUrl.host,
        'staging.api.sompay.example',
      );
    });
  });
}
