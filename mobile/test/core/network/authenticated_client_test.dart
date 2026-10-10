import 'package:almapay/core/auth/auth_tokens.dart';
import 'package:almapay/core/network/authenticated_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../support/fake_token_store.dart';

void main() {
  const initial = AuthTokens(
    accessToken: 'access-old',
    refreshToken: 'refresh-1',
  );

  test('attaches the current access token to the request', () async {
    final store = FakeTokenStore(initial);
    String? seen;
    final inner = MockClient((request) async {
      seen = request.headers['authorization'];
      return http.Response('{}', 200);
    });
    final client = AuthenticatedClient(
      inner: inner,
      tokenStore: store,
      refresher: _neverCalledRefresher(store),
    );

    await client.get(Uri.parse('https://api.test/api/v1/me'));
    expect(seen, 'Bearer access-old');
  });

  test('on 401 it refreshes once and retries with the new token', () async {
    final store = FakeTokenStore(initial);
    final authHeaders = <String?>[];
    final inner = MockClient((request) async {
      authHeaders.add(request.headers['authorization']);
      return http.Response(
        '{}',
        request.headers['authorization'] == 'Bearer access-new' ? 200 : 401,
      );
    });
    var refreshCalls = 0;
    final refresher = TokenRefresher(
      tokenStore: store,
      refresh: (_) async {
        refreshCalls++;
        return const AuthTokens(
          accessToken: 'access-new',
          refreshToken: 'refresh-2',
        );
      },
      onSessionExpired: () => fail('should not expire'),
    );

    final response = await AuthenticatedClient(
      inner: inner,
      tokenStore: store,
      refresher: refresher,
    ).get(Uri.parse('https://api.test/api/v1/me'));

    expect(response.statusCode, 200);
    expect(refreshCalls, 1);
    expect(authHeaders, ['Bearer access-old', 'Bearer access-new']);
    expect(store.current?.accessToken, 'access-new');
  });

  test(
    'when refresh fails it clears tokens, signals expiry and returns the 401',
    () async {
      final store = FakeTokenStore(initial);
      final inner = MockClient(
        (_) async => http.Response('{"error":{"code":"UNAUTHORIZED"}}', 401),
      );
      var expired = false;
      final refresher = TokenRefresher(
        tokenStore: store,
        refresh: (_) async => throw Exception('refresh rejected'),
        onSessionExpired: () => expired = true,
      );

      final response = await AuthenticatedClient(
        inner: inner,
        tokenStore: store,
        refresher: refresher,
      ).get(Uri.parse('https://api.test/api/v1/me'));

      expect(response.statusCode, 401);
      expect(expired, isTrue);
      expect(store.current, isNull);
    },
  );

  test('concurrent 401s trigger only one refresh', () async {
    final store = FakeTokenStore(initial);
    final inner = MockClient((request) async {
      return http.Response(
        '{}',
        request.headers['authorization'] == 'Bearer access-new' ? 200 : 401,
      );
    });
    var refreshCalls = 0;
    final refresher = TokenRefresher(
      tokenStore: store,
      refresh: (_) async {
        refreshCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 10));
        return const AuthTokens(
          accessToken: 'access-new',
          refreshToken: 'refresh-2',
        );
      },
      onSessionExpired: () {},
    );
    final client = AuthenticatedClient(
      inner: inner,
      tokenStore: store,
      refresher: refresher,
    );

    await Future.wait([
      client.get(Uri.parse('https://api.test/a')),
      client.get(Uri.parse('https://api.test/b')),
      client.get(Uri.parse('https://api.test/c')),
    ]);

    expect(refreshCalls, 1);
  });
}

TokenRefresher _neverCalledRefresher(FakeTokenStore store) => TokenRefresher(
  tokenStore: store,
  refresh: (_) async => fail('refresh should not be called'),
  onSessionExpired: () => fail('should not expire'),
);
