import 'dart:async';

import 'package:http/http.dart' as http;

import '../auth/auth_tokens.dart';
import '../auth/token_store.dart';

/// Refreshes the access token using the stored refresh token, coalescing
/// concurrent callers so only one refresh request is ever in flight.
class TokenRefresher {
  TokenRefresher({
    required TokenStore tokenStore,
    required Future<AuthTokens> Function(String refreshToken) refresh,
    required void Function() onSessionExpired,
  }) : _tokenStore = tokenStore,
       _refresh = refresh,
       _onSessionExpired = onSessionExpired;

  final TokenStore _tokenStore;
  final Future<AuthTokens> Function(String refreshToken) _refresh;
  final void Function() _onSessionExpired;

  Future<AuthTokens?>? _inFlight;

  /// Returns the new tokens, or `null` if the session could not be renewed
  /// (in which case the store is cleared and [onSessionExpired] has fired).
  Future<AuthTokens?> refreshTokens() {
    return _inFlight ??= _run()..whenComplete(() => _inFlight = null);
  }

  Future<AuthTokens?> _run() async {
    final current = await _tokenStore.read();
    if (current == null) {
      _onSessionExpired();
      return null;
    }
    try {
      final renewed = await _refresh(current.refreshToken);
      await _tokenStore.write(renewed);
      return renewed;
    } catch (_) {
      await _tokenStore.clear();
      _onSessionExpired();
      return null;
    }
  }
}

/// An [http.Client] that attaches the current access token and transparently
/// refreshes it once on a `401`, retrying the original request.
class AuthenticatedClient extends http.BaseClient {
  AuthenticatedClient({
    required http.Client inner,
    required TokenStore tokenStore,
    required TokenRefresher refresher,
  }) : _inner = inner,
       _tokenStore = tokenStore,
       _refresher = refresher;

  final http.Client _inner;
  final TokenStore _tokenStore;
  final TokenRefresher _refresher;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final buffered = await _Buffered.of(request);

    final first = await _sendWith(
      buffered,
      (await _tokenStore.read())?.accessToken,
    );
    if (first.statusCode != 401) {
      return first;
    }

    final renewed = await _refresher.refreshTokens();
    if (renewed == null) {
      return first;
    }
    return _sendWith(buffered, renewed.accessToken);
  }

  Future<http.StreamedResponse> _sendWith(
    _Buffered buffered,
    String? accessToken,
  ) {
    final replay = buffered.toRequest();
    if (accessToken != null) {
      replay.headers['authorization'] = 'Bearer $accessToken';
    }
    return _inner.send(replay);
  }

  @override
  void close() {
    _inner.close();
    super.close();
  }
}

/// A replayable snapshot of a request (a stream body can only be read once).
class _Buffered {
  _Buffered(this.method, this.url, this.headers, this.body);

  final String method;
  final Uri url;
  final Map<String, String> headers;
  final List<int> body;

  static Future<_Buffered> of(http.BaseRequest request) async {
    final bytes = await request.finalize().toBytes();
    return _Buffered(
      request.method,
      request.url,
      Map.of(request.headers),
      bytes,
    );
  }

  http.Request toRequest() => http.Request(method, url)
    ..headers.addAll(headers)
    ..bodyBytes = body;
}
