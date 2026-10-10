import 'package:http/http.dart' as http;

/// Certificate pinning needs `dart:io` sockets, which a browser does not have.
/// The browser enforces TLS itself; the web build (the demo) never pins.
http.Client createPinnedClient(Set<String> pins, {Object? context}) {
  throw UnsupportedError('Certificate pinning is not available on the web.');
}
