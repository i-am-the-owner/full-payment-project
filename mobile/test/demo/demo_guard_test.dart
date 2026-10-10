import 'dart:io';

import 'package:almapay/app/environment/app_config.dart';
import 'package:almapay/app/environment/app_environment.dart';
import 'package:flutter_test/flutter_test.dart';

/// Demo mode must be impossible in a production build, and must never be able to
/// reach a real provider.
void main() {
  group('the real app refuses the demo', () {
    test('in every build mode', () {
      for (final release in [true, false]) {
        expect(
          () => AppEnvironment.resolveFrom('demo', isReleaseMode: release),
          throwsStateError,
          reason: release ? 'release' : 'debug',
        );
      }
    });

    test('production and staging are unaffected', () {
      expect(
        AppEnvironment.resolveFrom('production', isReleaseMode: true),
        AppEnvironment.production,
      );
      expect(
        AppEnvironment.resolveFrom('staging', isReleaseMode: true),
        AppEnvironment.staging,
      );
    });
  });

  group('the demo entry point', () {
    test('accepts only ALMAPAY_ENV=demo', () {
      for (final raw in ['', 'production', 'staging', 'development', 'Demo']) {
        expect(
          () => AppEnvironment.resolveDemoFrom(
            raw,
            isReleaseMode: false,
            allowDemoRelease: true,
          ),
          throwsStateError,
          reason: raw,
        );
      }
      expect(
        AppEnvironment.resolveDemoFrom(
          'demo',
          isReleaseMode: false,
          allowDemoRelease: false,
        ),
        AppEnvironment.demo,
      );
    });

    test('a release build needs the demo workflows extra flag', () {
      expect(
        () => AppEnvironment.resolveDemoFrom(
          'demo',
          isReleaseMode: true,
          allowDemoRelease: false,
        ),
        throwsStateError,
      );
      expect(
        AppEnvironment.resolveDemoFrom(
          'demo',
          isReleaseMode: true,
          allowDemoRelease: true,
        ),
        AppEnvironment.demo,
      );
    });

    test('its address can never resolve, and it is never production', () {
      final config = AppConfig.forEnvironment(
        AppEnvironment.demo,
        isReleaseMode: true,
      );
      expect(config.apiBaseUrl.host, endsWith('.invalid'));
      expect(config.isProduction, isFalse);
      expect(config.appDisplayName, contains('Demo'));
    });
  });

  group('source guarantees', () {
    String read(String path) => File(path).readAsStringSync();

    test(
      'the real entry point and everything it uses never import the demo',
      () {
        final offenders = <String>[];
        for (final entity in Directory('lib').listSync(recursive: true)) {
          if (entity is! File || !entity.path.endsWith('.dart')) continue;
          final path = entity.path.replaceAll(r'\', '/');
          if (path.startsWith('lib/demo/') || path == 'lib/main_demo.dart')
            continue;
          if (RegExp(r"import\s+'[^']*demo[^']*'")
              .hasMatch(entity.readAsStringSync())) {
            offenders.add(path);
          }
        }
        expect(
          offenders,
          isEmpty,
          reason: 'a production build must not be able to include the demo',
        );
        expect(read('lib/main.dart'), isNot(contains('demo')));
      },
    );

    test(
      'the demo code has no way to reach a network, a bank or a provider',
      () {
        final forbidden = RegExp(
          r"import\s+'(dart:io|dart:html|dart:js[^']*|package:http/[^']*|package:webview_flutter[^']*|package:flutter_secure_storage[^']*|package:permission_handler[^']*|package:dio[^']*)'",
        );
        final files = [
          ...Directory('lib/demo').listSync(recursive: true).whereType<File>(),
          File('lib/main_demo.dart'),
        ];
        expect(files, isNotEmpty);
        for (final f in files.where((f) => f.path.endsWith('.dart'))) {
          final text = f.readAsStringSync();
          expect(
            forbidden.hasMatch(text),
            isFalse,
            reason: '${f.path} imports something that can reach out',
          );
          // Nor does it import the real app's network or provider-facing code.
          expect(
            RegExp(r"import\s+'(\.\./)+(core/network|core/auth|features)[^']*'")
                .hasMatch(text),
            isFalse,
            reason: '${f.path} imports the real app',
          );
        }
      },
    );
  });
}
