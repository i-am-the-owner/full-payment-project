import 'dart:convert';

import 'package:crypto/crypto.dart' show sha256;
import 'package:http/http.dart' as http;

import 'pinned_client_stub.dart' if (dart.library.io) 'pinned_client_io.dart';

export 'pinned_client_stub.dart'
    if (dart.library.io) 'pinned_client_io.dart'
    show createPinnedClient;

/// Certificate pinning for the AaminPay API. OFF unless the build sets
/// `--dart-define=ALMAPAY_PIN_CERTS=true` and `--dart-define=ALMAPAY_TLS_PINS=<pins>`.
/// It stays off until there is a production domain to pin (see GO_LIVE.md).
///
/// A pin is the base64 SHA-256 of the server certificate's SubjectPublicKeyInfo
/// (the same value as HPKP and `openssl ... | openssl dgst -sha256 -binary | base64`).
/// The check runs when the connection is made, BEFORE any request (and so before
/// any token) is sent. Dart exposes only the server's own (leaf) certificate, so
/// pin the leaf key and ALWAYS include a backup pin for the next key, or a
/// certificate renewal will lock every installed app out until it is updated.
class PinningConfig {
  const PinningConfig({required this.enabled, required this.pins});

  /// Reads the build-time flags.
  factory PinningConfig.fromEnvironment() {
    const enabled = bool.fromEnvironment('ALMAPAY_PIN_CERTS');
    const raw = String.fromEnvironment('ALMAPAY_TLS_PINS');
    return PinningConfig(enabled: enabled, pins: parsePins(raw));
  }

  final bool enabled;
  final Set<String> pins;

  /// Throws when the flag is on but cannot work: better to fail at start-up than
  /// to ship an app that either skips pinning or can never connect.
  void validateFor(Uri apiBaseUrl) {
    if (!enabled) return;
    if (apiBaseUrl.scheme != 'https') {
      throw StateError('Certificate pinning needs an https API URL.');
    }
    if (pins.length < 2) {
      throw StateError(
        'ALMAPAY_TLS_PINS needs at least two pins: the current key and a '
        'backup key, so a certificate renewal cannot lock users out.',
      );
    }
  }
}

/// Parses `sha256/AAAA...=,sha256/BBBB...=` (the `sha256/` prefix is optional).
Set<String> parsePins(String raw) {
  final pins = <String>{};
  for (final part in raw.split(',')) {
    final pin = part.trim().replaceFirst('sha256/', '');
    if (pin.isEmpty) continue;
    final bytes = base64.decode(pin);
    if (bytes.length != 32) {
      throw FormatException(
        'A TLS pin must be a base64 SHA-256 (32 bytes): $pin',
      );
    }
    pins.add(pin);
  }
  return pins;
}

/// The base64 SHA-256 of a DER X.509 certificate's SubjectPublicKeyInfo.
String spkiPin(List<int> certificateDer) {
  final cert = _Der(certificateDer, 0);
  final tbs = _Der.child(
    cert,
  ); // Certificate ::= SEQUENCE { tbsCertificate, ... }
  final fields = tbs.children();
  var i = 0;
  if (fields[i].tag == 0xA0) i++; // [0] version (absent in v1)
  i += 5; // serialNumber, signature, issuer, validity, subject
  final spki = fields[i];
  return base64.encode(sha256.convert(spki.encoded).bytes);
}

class _Der {
  _Der(this._bytes, this._offset) {
    var p = _offset;
    tag = _bytes[p++];
    var length = _bytes[p++];
    if (length & 0x80 != 0) {
      final count = length & 0x7F;
      length = 0;
      for (var k = 0; k < count; k++) {
        length = (length << 8) | _bytes[p++];
      }
    }
    _contentStart = p;
    _contentLength = length;
  }

  /// The first element inside a constructed [parent].
  factory _Der.child(_Der parent) => _Der(parent._bytes, parent._contentStart);

  final List<int> _bytes;
  final int _offset;
  late final int tag;
  late final int _contentStart;
  late final int _contentLength;

  /// The whole element: header and content.
  List<int> get encoded =>
      _bytes.sublist(_offset, _contentStart + _contentLength);

  List<_Der> children() {
    final out = <_Der>[];
    var p = _contentStart;
    final end = _contentStart + _contentLength;
    while (p < end) {
      final child = _Der(_bytes, p);
      out.add(child);
      p = child._contentStart + child._contentLength;
    }
    return out;
  }
}

/// The client factory for [config]: pinned when enabled, otherwise a plain client.
http.Client Function() clientFactoryFor(PinningConfig config, Uri apiBaseUrl) {
  config.validateFor(apiBaseUrl);
  if (!config.enabled) return http.Client.new;
  return () => createPinnedClient(config.pins);
}
