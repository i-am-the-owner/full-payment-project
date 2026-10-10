import 'package:almapay/app/environment/app_environment.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppEnvironment.fromName', () {
    test('parses each known environment name', () {
      expect(
        AppEnvironment.fromName('development'),
        AppEnvironment.development,
      );
      expect(AppEnvironment.fromName('staging'), AppEnvironment.staging);
      expect(AppEnvironment.fromName('production'), AppEnvironment.production);
    });

    test('throws ArgumentError for an unknown name', () {
      expect(() => AppEnvironment.fromName('prod'), throwsArgumentError);
    });
  });

  group('AppEnvironment.resolve', () {
    test('defaults to development when ALMAPAY_ENV is unset', () {
      // Tests run without --dart-define, so the default path is exercised.
      expect(AppEnvironment.resolve(), AppEnvironment.development);
    });
  });

  releaseModeTests();

  test('isProduction is true only for production', () {
    expect(AppEnvironment.production.isProduction, isTrue);
    expect(AppEnvironment.development.isProduction, isFalse);
    expect(AppEnvironment.staging.isProduction, isFalse);
  });
}

void releaseModeTests() {
  group('release builds', () {
    test('refuse to run without ALMAPAY_ENV or as development', () {
      expect(
        () => AppEnvironment.resolveFrom('', isReleaseMode: true),
        throwsStateError,
      );
      expect(
        () => AppEnvironment.resolveFrom('development', isReleaseMode: true),
        throwsStateError,
      );
      expect(
        AppEnvironment.resolveFrom('production', isReleaseMode: true),
        AppEnvironment.production,
      );
    });

    test('debug builds default to development', () {
      expect(
        AppEnvironment.resolveFrom('', isReleaseMode: false),
        AppEnvironment.development,
      );
    });
  });
}
