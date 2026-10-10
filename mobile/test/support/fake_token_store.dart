import 'package:almapay/core/auth/auth_tokens.dart';
import 'package:almapay/core/auth/token_store.dart';

/// In-memory [TokenStore] for tests.
class FakeTokenStore implements TokenStore {
  FakeTokenStore([this._tokens]);

  AuthTokens? _tokens;
  int writes = 0;
  int clears = 0;

  AuthTokens? get current => _tokens;

  @override
  Future<AuthTokens?> read() async => _tokens;

  @override
  Future<void> write(AuthTokens tokens) async {
    _tokens = tokens;
    writes++;
  }

  @override
  Future<void> clear() async {
    _tokens = null;
    clears++;
  }
}
