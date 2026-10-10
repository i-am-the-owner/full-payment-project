import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../features/auth/domain/auth_user.dart';
import '../auth/auth_tokens.dart';
import 'api_exception.dart';

/// Thin typed wrapper over the AaminPay auth + `/me` HTTP endpoints.
///
/// It never stores anything. Callers pass whichever `http.Client` is
/// appropriate: unauthenticated endpoints use a plain client; `/me` uses the
/// token-injecting client.
class AuthApi {
  AuthApi({required Uri baseUrl, required http.Client client})
    : _baseUrl = baseUrl,
      _client = client;

  final Uri _baseUrl;
  final http.Client _client;

  Uri _uri(String path) => _baseUrl.resolve(path);

  Future<void> register({
    required String email,
    required String password,
  }) async {
    await _postJson('api/v1/auth/register', {
      'email': email,
      'password': password,
    });
  }

  /// [totpCode] is the 6-digit authenticator code, sent only when the account
  /// has two-step sign-in turned on.
  Future<AuthTokens> login({
    required String email,
    required String password,
    String? totpCode,
  }) async {
    final body = await _postJson('api/v1/auth/login', {
      'email': email,
      'password': password,
      'totpCode': ?totpCode,
    });
    return _tokensFrom(body);
  }

  /// Confirms an email address with the code from the verification email.
  Future<void> verifyEmail(String token) async {
    await _postJson('api/v1/auth/email/verify', {'token': token});
  }

  /// Sends the verification email again. Needs the token-injecting client.
  Future<void> resendVerificationEmail() async {
    await _postJson('api/v1/auth/email/resend', const {});
  }

  Future<AuthTokens> refresh(String refreshToken) async {
    final body = await _postJson('api/v1/auth/refresh', {
      'refreshToken': refreshToken,
    });
    return _tokensFrom(body);
  }

  Future<void> logout(String refreshToken) async {
    await _postJson('api/v1/auth/logout', {'refreshToken': refreshToken});
  }

  Future<void> requestPasswordReset(String email) async {
    await _postJson('api/v1/auth/password/forgot', {'email': email});
  }

  Future<AuthUser> me() async {
    final response = await _send(http.Request('GET', _uri('api/v1/me')));
    return AuthUser.fromJson(_decodeData(response));
  }

  // --- internals -------------------------------------------------------

  Future<Map<String, dynamic>> _postJson(
    String path,
    Map<String, dynamic> payload,
  ) async {
    final request = http.Request('POST', _uri(path))
      ..headers['content-type'] = 'application/json'
      ..body = jsonEncode(payload);
    final response = await _send(request);
    return _decodeData(response);
  }

  Future<http.Response> _send(http.BaseRequest request) async {
    final http.StreamedResponse streamed;
    try {
      streamed = await _client.send(request);
    } on http.ClientException catch (error) {
      throw ApiException.network(error);
    }
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode >= 400) {
      throw _errorFrom(response);
    }
    return response;
  }

  Map<String, dynamic> _decodeData(http.Response response) {
    if (response.body.isEmpty) {
      return const {};
    }
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return (decoded['data'] as Map<String, dynamic>?) ?? const {};
  }

  AuthTokens _tokensFrom(Map<String, dynamic> data) => AuthTokens(
    accessToken: data['accessToken'] as String,
    refreshToken: data['refreshToken'] as String,
  );

  ApiException _errorFrom(http.Response response) {
    Map<String, dynamic> error = const {};
    try {
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      error = (decoded['error'] as Map<String, dynamic>?) ?? const {};
    } on FormatException {
      // Non-JSON error body – fall back to the status code.
    }
    return ApiException(
      statusCode: response.statusCode,
      code: error['code'] as String? ?? 'HTTP_${response.statusCode}',
      message: error['message'] as String? ?? 'The request failed.',
      fieldErrors: ((error['fieldErrors'] as List<dynamic>?) ?? const [])
          .map(
            (entry) => ApiFieldError(
              field: (entry as Map<String, dynamic>)['field'] as String? ?? '',
              message: entry['message'] as String? ?? '',
            ),
          )
          .toList(growable: false),
    );
  }
}
