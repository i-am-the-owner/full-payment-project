import 'package:almapay/core/auth/auth_tokens.dart';
import 'package:almapay/core/auth/token_store.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final store = <String, String>{};

  setUp(() {
    store.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          final args = (call.arguments as Map).cast<String, Object?>();
          switch (call.method) {
            case 'write':
              store[args['key']! as String] = args['value']! as String;
              return null;
            case 'read':
              return store[args['key']! as String];
            case 'delete':
              store.remove(args['key']! as String);
              return null;
            case 'containsKey':
              return store.containsKey(args['key']! as String);
            default:
              return null;
          }
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('read returns null when nothing is stored', () async {
    expect(await SecureTokenStore().read(), isNull);
  });

  test('write then read round-trips the token pair', () async {
    final tokenStore = SecureTokenStore();
    await tokenStore.write(
      const AuthTokens(accessToken: 'access-1', refreshToken: 'refresh-1'),
    );

    expect(
      await tokenStore.read(),
      const AuthTokens(accessToken: 'access-1', refreshToken: 'refresh-1'),
    );
    // Tokens are stored under namespaced keys, not in the clear under obvious names.
    expect(
      store.keys,
      containsAll(['almapay.auth.access_token', 'almapay.auth.refresh_token']),
    );
  });

  test('read returns null if only one half is present', () async {
    store['almapay.auth.access_token'] = 'orphan';
    expect(await SecureTokenStore().read(), isNull);
  });

  test('clear removes both tokens', () async {
    final tokenStore = SecureTokenStore();
    await tokenStore.write(
      const AuthTokens(accessToken: 'a', refreshToken: 'r'),
    );
    await tokenStore.clear();

    expect(await tokenStore.read(), isNull);
    expect(store, isEmpty);
  });

  test('AuthTokens.toString never exposes the values', () {
    const tokens = AuthTokens(
      accessToken: 'super-secret',
      refreshToken: 'also-secret',
    );
    expect(tokens.toString(), isNot(contains('super-secret')));
    expect(tokens.toString(), isNot(contains('also-secret')));
  });
}
