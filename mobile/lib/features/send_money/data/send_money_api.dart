import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../core/network/api_exception.dart';
import '../domain/models.dart';

/// Typed wrapper over the AaminPay send-money HTTP endpoints. Always used with
/// the token-injecting client — every endpoint needs a verified session.
///
/// It stores nothing and decides nothing: it forwards the customer's input and
/// returns exactly what the backend says.
class SendMoneyApi {
  SendMoneyApi({required Uri baseUrl, required http.Client client})
    : _baseUrl = baseUrl,
      _client = client;

  final Uri _baseUrl;
  final http.Client _client;

  Uri _uri(String path) => _baseUrl.resolve(path);

  /// The currencies the payout provider supports right now.
  Future<SupportedCurrencies> getCurrencies() async {
    final data = await _send(http.Request('GET', _uri('api/v1/currencies')));
    return SupportedCurrencies.fromJson(data);
  }

  /// Amounts travel as decimal strings, exactly as typed: never as numbers.
  Future<Quote> createQuote({
    required String sourceCurrency,
    required String targetCurrency,
    String? sourceAmount,
    String? targetAmount,
  }) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/quotes', {
        'sourceCurrency': sourceCurrency,
        'targetCurrency': targetCurrency,
        'sourceAmount': ?sourceAmount,
        'targetAmount': ?targetAmount,
      }),
    );
    return Quote.fromJson(data);
  }

  Future<Quote> attachRecipient({
    required String quoteId,
    required String recipientId,
  }) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/quotes/$quoteId/recipient', {
        'recipientId': recipientId,
      }),
    );
    return Quote.fromJson(data);
  }

  Future<void> deleteRecipient(String id) async {
    await _send(http.Request('DELETE', _uri('api/v1/recipients/$id')));
  }

  /// How to pay the provider. Fetched each time; never cached or stored.
  Future<FundingInfo> getFunding(String transferId) async {
    final data = await _send(
      http.Request('GET', _uri('api/v1/transfers/$transferId/funding')),
    );
    return FundingInfo.fromJson(data);
  }

  Future<FundResult> fund(String transferId, String method) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/transfers/$transferId/fund', {
        'method': method,
      }),
    );
    return FundResult.fromJson(data);
  }

  /// Development only: the mock provider's "next step" tool.
  Future<void> advanceMockTransfer(String id) async {
    await _send(
      _jsonRequest('POST', 'dev/mock/transfers/$id/advance', const {}),
    );
  }

  Future<List<Recipient>> listRecipients() async {
    final data = await _send(http.Request('GET', _uri('api/v1/recipients')));
    return ((data['recipients'] as List<dynamic>? ?? const []))
        .map((e) => Recipient.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  /// The provider's recipient form for a currency and country. Pass the values
  /// entered so far when a `refreshOnChange` field changed.
  Future<DynamicForm> getRecipientForm({
    required String currency,
    required String country,
    String? quoteId,
    Map<String, String>? partialValues,
  }) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/recipient-form', {
        'currency': currency,
        'country': country,
        'quoteId': ?quoteId,
        'partialValues': ?partialValues,
      }),
    );
    return DynamicForm.fromJson(data);
  }

  Future<Recipient> createRecipient(NewRecipient recipient) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/recipients', recipient.toJson()),
    );
    return Recipient.fromJson(data);
  }

  /// The provider's extra questions for this transfer (for example its purpose).
  Future<DynamicForm> getTransferForm({
    required String quoteId,
    required String recipientId,
  }) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/transfer-form', {
        'quoteId': quoteId,
        'recipientId': recipientId,
      }),
    );
    return DynamicForm.fromJson(data);
  }

  Future<Transfer> createTransfer({
    required String quoteId,
    required String recipientId,
    required Map<String, String> answers,
    required String idempotencyKey,
    String? reference,
  }) async {
    final request = _jsonRequest('POST', 'api/v1/transfers', {
      'quoteId': quoteId,
      'recipientId': recipientId,
      'answers': answers,
      'reference': ?reference,
    })..headers['idempotency-key'] = idempotencyKey;
    return Transfer.fromJson(await _send(request));
  }

  Future<TransferPage> listTransfers({int page = 1}) async {
    final data = await _send(
      http.Request('GET', _uri('api/v1/transfers?page=$page&pageSize=20')),
    );
    return TransferPage.fromJson(data);
  }

  Future<Transfer> getTransfer(String id) async {
    final data = await _send(http.Request('GET', _uri('api/v1/transfers/$id')));
    return Transfer.fromJson(data);
  }

  /// Asks the backend to check the transfer with the provider now.
  Future<Transfer> refreshTransfer(String id) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/transfers/$id/refresh', const {}),
    );
    return Transfer.fromJson(data);
  }

  Future<Transfer> cancelTransfer(String id) async {
    final data = await _send(
      _jsonRequest('POST', 'api/v1/transfers/$id/cancel', const {}),
    );
    return Transfer.fromJson(data);
  }

  // --- internals -------------------------------------------------------

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
    if (response.statusCode >= 400) {
      throw _errorFrom(response);
    }
    if (response.body.isEmpty) {
      return const {};
    }
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return (decoded['data'] as Map<String, dynamic>?) ?? const {};
  }

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
