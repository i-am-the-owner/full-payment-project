import 'dart:convert';
import 'dart:io';

import 'package:almapay/core/network/certificate_pinning.dart';
import 'package:flutter_test/flutter_test.dart';

/// Makes a throwaway self-signed certificate with openssl (nothing secret is
/// committed). The tests that need it are skipped where openssl is missing.
Future<({String cert, String key, String pin})?> _makeCert(
  Directory dir,
) async {
  final key = '${dir.path}/key.pem';
  final cert = '${dir.path}/cert.pem';
  try {
    final made = await Process.run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ]);
    if (made.exitCode != 0) return null;
    // The reference pin, computed by openssl itself.
    final pub = await Process.run('sh', [
      '-c',
      'openssl x509 -in $cert -pubkey -noout | openssl pkey -pubin -outform DER '
          '| openssl dgst -sha256 -binary | base64',
    ]);
    if (pub.exitCode != 0) return null;
    return (cert: cert, key: key, pin: (pub.stdout as String).trim());
  } on ProcessException {
    return null;
  }
}

void main() {
  group('pin parsing and config', () {
    test('accepts base64 SHA-256 pins with or without the sha256/ prefix', () {
      final a = base64.encode(List.filled(32, 1));
      final b = base64.encode(List.filled(32, 2));
      expect(parsePins('sha256/$a, $b'), {a, b});
      expect(parsePins(''), isEmpty);
      expect(() => parsePins('c2hvcnQ='), throwsFormatException);
    });

    test('is off by default and needs two pins and https when on', () {
      final a = base64.encode(List.filled(32, 1));
      final b = base64.encode(List.filled(32, 2));
      const off = PinningConfig(enabled: false, pins: {});
      off.validateFor(Uri.parse('http://10.0.2.2:3000')); // no complaint
      expect(
        () => PinningConfig(
          enabled: true,
          pins: {a, b},
        ).validateFor(Uri.parse('http://x.example')),
        throwsStateError,
      );
      expect(
        () => PinningConfig(
          enabled: true,
          pins: {a},
        ).validateFor(Uri.parse('https://x.example')),
        throwsStateError,
        reason: 'a single pin would lock users out at renewal',
      );
      PinningConfig(
        enabled: true,
        pins: {a, b},
      ).validateFor(Uri.parse('https://x.example'));
    });
  });

  group('against a real local TLS server', () {
    late Directory dir;
    late ({String cert, String key, String pin})? made;
    HttpServer? server;

    setUpAll(() async {
      dir = await Directory.systemTemp.createTemp('pin');
      made = await _makeCert(dir);
      if (made == null) return;
      final context = SecurityContext()
        ..useCertificateChain(made!.cert)
        ..usePrivateKey(made!.key);
      server = await HttpServer.bindSecure('127.0.0.1', 0, context);
      server!.listen((req) {
        req.response
          ..write('hello')
          ..close();
      });
    });
    tearDownAll(() async {
      await server?.close(force: true);
      await dir.delete(recursive: true);
    });

    SecurityContext trustServer() =>
        SecurityContext(withTrustedRoots: false)
          ..setTrustedCertificates(made!.cert);

    test('the SPKI pin we compute equals the one openssl computes', () {
      if (made == null) markTestSkipped('openssl is not available');
      final pem = File(made!.cert).readAsStringSync();
      final body = pem.split('\n').where((l) => !l.startsWith('-----')).join();
      expect(spkiPin(base64.decode(body)), made!.pin);
    });

    test(
      'connects when the key is pinned, and sends nothing when it is not',
      () async {
        if (made == null) {
          markTestSkipped('openssl is not available');
          return;
        }
        final url = Uri.parse('https://localhost:${server!.port}/');
        final backup = base64.encode(List.filled(32, 9));

        final good = createPinnedClient({
          made!.pin,
          backup,
        }, context: trustServer());
        expect((await good.get(url)).body, 'hello');
        good.close();

        final wrong = createPinnedClient({backup}, context: trustServer());
        await expectLater(wrong.get(url), throwsA(anything));
        wrong.close();
      },
    );
  });
}
