import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../core/network/api_exception.dart';
import '../domain/onboarding_models.dart';
import '../domain/onboarding_repository.dart';

/// Typed wrapper over the AaminPay profile and onboarding endpoints. Always
/// used with the token-injecting client. It talks only to the AaminPay backend,
/// never to a payment provider.
class OnboardingApi implements OnboardingRepository {
  OnboardingApi({required Uri baseUrl, required http.Client client})
    : _baseUrl = baseUrl,
      _client = client;

  final Uri _baseUrl;
  final http.Client _client;

  @override
  Future<OnboardingStatus> getStatus() async => OnboardingStatus.fromJson(
    await _send(http.Request('GET', _uri('api/v1/onboarding/status'))),
  );

  @override
  Future<ProfileForm> getProfileForm() async => ProfileForm.fromJson(
    await _send(http.Request('GET', _uri('api/v1/profile'))),
  );

  @override
  Future<void> saveProfile(CustomerProfile profile) async {
    await _send(_jsonRequest('PUT', 'api/v1/profile', profile.toJson()));
  }

  @override
  Future<OnboardingStart> startIdentityCheck() async =>
      OnboardingStart.fromJson(
        await _send(_jsonRequest('POST', 'api/v1/onboarding/start', const {})),
      );

  // --- internals -------------------------------------------------------

  Uri _uri(String path) => _baseUrl.resolve(path);

  http.Request _jsonRequest(
    String method,
    String path,
    Map<String, dynamic> payload,
  ) => http.Request(method, _uri(path))
    ..headers['content-type'] = 'application/json'
    ..body = jsonEncode(payload);

  Future<Map<String, dynamic>> _send(http.BaseRequest request) async {
    final http.StreamedResponse streamed;
    try {
      streamed = await _client.send(request);
    } on http.ClientException catch (error) {
      throw ApiException.network(error);
    }
    final response = await http.Response.fromStream(streamed);
    Map<String, dynamic> decoded = const {};
    try {
      if (response.body.isNotEmpty) {
        decoded = jsonDecode(response.body) as Map<String, dynamic>;
      }
    } on FormatException {
      // Non-JSON body – fall back to the status code below.
    }
    if (response.statusCode >= 400) {
      final error = (decoded['error'] as Map<String, dynamic>?) ?? const {};
      throw ApiException(
        statusCode: response.statusCode,
        code: error['code'] as String? ?? 'HTTP_${response.statusCode}',
        message: error['message'] as String? ?? 'The request failed.',
        fieldErrors: ((error['fieldErrors'] as List<dynamic>?) ?? const [])
            .map(
              (entry) => ApiFieldError(
                field:
                    (entry as Map<String, dynamic>)['field'] as String? ?? '',
                message: entry['message'] as String? ?? '',
              ),
            )
            .toList(growable: false),
      );
    }
    return (decoded['data'] as Map<String, dynamic>?) ?? const {};
  }
}
