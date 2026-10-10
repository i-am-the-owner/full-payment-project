import 'dart:convert';

import 'package:almapay/core/auth/auth_tokens.dart';
import 'package:almapay/core/network/api_exception.dart';
import 'package:almapay/core/network/auth_api.dart';
import 'package:almapay/features/auth/data/auth_repository_impl.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../support/fake_token_store.dart';

final _baseUrl = Uri.parse('https://api.test/');
const _stored = AuthTokens(accessToken: 'a-stub', refreshToken: 'r-stub');

AuthApi _api(MockClient client) => AuthApi(baseUrl: _baseUrl, client: client);

http.Response _ok(Map<String, dynamic> data) => http.Response(
  jsonEncode({
    'data': data,
    'meta': {'requestId': 'r', 'timestamp': 't'},
  }),
  200,
  headers: {'content-type': 'application/json'},
);

AuthRepositoryImpl _repo(MockClient client, FakeTokenStore store) =>
    AuthRepositoryImpl(
      publicApi: _api(client),
      authenticatedApi: _api(client),
      tokenStore: store,
    );

void main() {
  test('login stores the token pair and returns the account', () async {
    final store = FakeTokenStore();
    final client = MockClient((request) async {
      if (request.url.path == '/api/v1/auth/login') {
        return _ok({'accessToken': 'a1', 'refreshToken': 'r1'});
      }
      if (request.url.path == '/api/v1/me') {
        return _ok({
          'id': 'u1',
          'email': 'user@example.test',
          'emailVerified': false,
          'roles': ['customer'],
        });
      }
      return http.Response('not found', 404);
    });

    final user = await _repo(
      client,
      store,
    ).login(email: 'user@example.test', password: 'a strong passphrase');

    expect(user.email, 'user@example.test');
    expect(
      store.current,
      const AuthTokens(accessToken: 'a1', refreshToken: 'r1'),
    );
  });

  test('currentUser returns null and clears tokens on 401', () async {
    final store = FakeTokenStore(_stored);
    final client = MockClient(
      (_) async =>
          http.Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', 401),
    );

    expect(await _repo(client, store).currentUser(), isNull);
    expect(store.current, isNull);
  });

  test(
    'currentUser returns null immediately when there is no stored token',
    () async {
      final client = MockClient((_) async => fail('no request expected'));
      expect(await _repo(client, FakeTokenStore()).currentUser(), isNull);
    },
  );

  test('logout revokes on the backend then clears local tokens', () async {
    final store = FakeTokenStore(_stored);
    String? loggedOutWith;
    final client = MockClient((request) async {
      loggedOutWith =
          (jsonDecode(request.body) as Map)['refreshToken'] as String?;
      return _ok(const {});
    });

    await _repo(client, store).logout();

    expect(loggedOutWith, 'r-stub');
    expect(store.current, isNull);
  });

  test('register propagates a validation ApiException', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': 'bad',
            'fieldErrors': [
              {'field': 'body.password', 'message': 'too short'},
            ],
          },
        }),
        400,
      ),
    );

    await expectLater(
      _repo(
        client,
        FakeTokenStore(),
      ).register(email: 'a@b.test', password: 'short'),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION_ERROR'),
      ),
    );
  });
}
