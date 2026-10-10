import '../../../core/auth/token_store.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/auth_api.dart';
import '../domain/auth_repository.dart';
import '../domain/auth_user.dart';

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({
    required AuthApi publicApi,
    required AuthApi authenticatedApi,
    required TokenStore tokenStore,
  }) : _publicApi = publicApi,
       _authenticatedApi = authenticatedApi,
       _tokenStore = tokenStore;

  /// Uses a plain HTTP client – these endpoints take no access token.
  final AuthApi _publicApi;

  /// Uses the token-injecting client (attaches + refreshes the access token).
  final AuthApi _authenticatedApi;

  final TokenStore _tokenStore;

  @override
  Future<void> register({required String email, required String password}) {
    return _publicApi.register(email: email, password: password);
  }

  @override
  Future<AuthUser> login({
    required String email,
    required String password,
    String? totpCode,
  }) async {
    final tokens = await _publicApi.login(
      email: email,
      password: password,
      totpCode: totpCode,
    );
    await _tokenStore.write(tokens);
    return _authenticatedApi.me();
  }

  @override
  Future<void> verifyEmail(String token) => _publicApi.verifyEmail(token);

  @override
  Future<void> resendVerificationEmail() =>
      _authenticatedApi.resendVerificationEmail();

  @override
  Future<void> requestPasswordReset(String email) {
    return _publicApi.requestPasswordReset(email);
  }

  @override
  Future<void> logout() async {
    final tokens = await _tokenStore.read();
    if (tokens != null) {
      try {
        await _publicApi.logout(tokens.refreshToken);
      } on ApiException {
        // Best effort – the local session is cleared regardless.
      }
    }
    await _tokenStore.clear();
  }

  @override
  Future<AuthUser?> currentUser() async {
    if (await _tokenStore.read() == null) {
      return null;
    }
    try {
      return await _authenticatedApi.me();
    } on ApiException catch (error) {
      if (error.isUnauthorized) {
        await _tokenStore.clear();
        return null;
      }
      rethrow;
    }
  }
}
