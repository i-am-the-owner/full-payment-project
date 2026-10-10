import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'certificate_pinning.dart' show spkiPin;

/// True when the certificate's key matches one of [pins].
bool certificateMatchesPins(X509Certificate certificate, Set<String> pins) =>
    pins.contains(spkiPin(certificate.der));

/// An HTTP client that only completes a TLS connection to a server whose key is pinned.
http.Client createPinnedClient(Set<String> pins, {SecurityContext? context}) {
  final inner = HttpClient(context: context)
    ..connectionFactory = (uri, proxyHost, proxyPort) async {
      final host = proxyHost ?? uri.host;
      final port = proxyPort ?? uri.port;
      final task = await SecureSocket.startConnect(
        host,
        port,
        context: context,
      );
      final verified = task.socket.then((socket) {
        final cert = socket.peerCertificate;
        if (cert == null || !certificateMatchesPins(cert, pins)) {
          socket.destroy();
          throw const HandshakeException(
            'The server certificate is not pinned.',
          );
        }
        return socket;
      });
      return ConnectionTask.fromSocket<SecureSocket>(verified, task.cancel);
    }
    ..findProxy = (uri) => 'DIRECT';
  return IOClient(inner);
}
