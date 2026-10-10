import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// The mock provider's own forms, exported from the backend
/// (`backend/scripts/export-mock-forms.ts`).
final Map<String, dynamic> mockForms = jsonDecode(
  File('test/fixtures/mock_forms.json').readAsStringSync(),
) as Map<String, dynamic>;

Map<String, dynamic> mockRecipientForm(
  String currency, {
  bool business = false,
}) =>
    ((mockForms['recipient'] as Map<String, dynamic>)[currency]
            as Map<String, dynamic>)[business ? 'BUSINESS' : 'PRIVATE']
        as Map<String, dynamic>;

Map<String, dynamic> mockTransferForm(String currency) =>
    (mockForms['transfer'] as Map<String, dynamic>)[currency]
        as Map<String, dynamic>;

const _mockStatuses = ['AWAITING_FUNDS', 'PROCESSING', 'SENT', 'COMPLETED'];

/// An in-memory stand-in for the AaminPay backend running on the mock
/// provider. It behaves like the real API for the send-money flow: quotes
/// expire, confirmations are idempotent, limits apply, statuses only move
/// when "the provider" moves them. All money is integer minor units.
class FakeSendMoneyBackend {
  FakeSendMoneyBackend({DateTime? now})
    : now = now ?? DateTime.utc(2026, 10, 3, 12);

  /// The backend's clock; tests move it to expire quotes.
  DateTime now;

  /// Per-transfer limit in minor units of GBP.
  int perTransferLimit = 500000;

  /// Fail the next N calls to this `METHOD /path` as if the network dropped.
  final Map<String, int> dropNext = {};

  /// Balance payments above this need the customer's approval (SCA).
  int scaAbove = 500000;

  final requests = <http.Request>[];
  final _quotes = <String, Map<String, dynamic>>{};
  final recipients = <Map<String, dynamic>>[];
  final transfers = <Map<String, dynamic>>[];
  final _events = <String, List<Map<String, dynamic>>>{};

  /// How many transfers "the provider" has created.
  int providerTransfers = 0;
  int _ids = 0;

  static const _rates = {'EUR': 117, 'USD': 127, 'INR': 10550, 'MXN': 2310};
  static const _minor = {'GBP': 2, 'EUR': 2, 'USD': 2, 'INR': 2, 'MXN': 2};

  late final http.Client client = MockClient(_handle);

  // --- helpers for tests -------------------------------------------------

  int count(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path).length;

  http.Request last(String method, String path) =>
      requests.lastWhere((r) => r.method == method && r.url.path == path);

  Map<String, dynamic> lastBody(String method, String path) =>
      jsonDecode(last(method, path).body) as Map<String, dynamic>;

  Map<String, dynamic> addSavedRecipient({
    String currency = 'EUR',
    String country = 'DE',
    String name = 'Anna Schmidt',
    bool business = false,
  }) {
    final recipient = {
      'id': 'r-${++_ids}',
      'displayName': name,
      'accountHolderName': name,
      'country': country,
      'currency': currency,
      'accountSummary': 'IBAN ••••3000',
      'isActive': true,
      '_business': business,
    };
    recipients.add(recipient);
    return recipient;
  }

  // --- money, as integers ---------------------------------------------------

  static int _toMinor(String amount) {
    final parts = amount.split('.');
    final fraction = (parts.length > 1 ? parts[1] : '').padRight(2, '0');
    return int.parse(parts[0]) * 100 + int.parse(fraction);
  }

  static Map<String, dynamic> _money(String currency, int minor) => {
    'currency': currency,
    'amount':
        '${minor ~/ 100}.${(minor % 100).toString().padLeft(_minor[currency] ?? 2, '0')}',
    'amountMinor': '$minor',
  };

  Map<String, dynamic> _quote({
    required String source,
    required String target,
    required int total,
    required int fee,
    bool priceChanged = false,
  }) {
    final rate = _rates[target]!;
    final id = 'q-${++_ids}';
    final quote = {
      'id': id,
      'source': _money(source, total - fee),
      'fee': _money(source, fee),
      'totalToPay': _money(source, total),
      'target': _money(target, (total - fee) * rate ~/ 100),
      'exchangeRate':
          '${rate ~/ 100}.${(rate % 100).toString().padLeft(2, '0')}',
      'estimatedDelivery': now.add(const Duration(days: 1)).toIso8601String(),
      'expiresAt': now.add(const Duration(minutes: 30)).toIso8601String(),
      'priceChanged': priceChanged,
    };
    _quotes[id] = quote;
    return quote;
  }

  bool _expired(Map<String, dynamic> quote) =>
      !DateTime.parse(quote['expiresAt'] as String).isAfter(now);

  // --- responses ------------------------------------------------------------

  http.Response _ok(Object data, [int status = 200]) => http.Response(
    jsonEncode({'data': data}),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );

  http.Response _error(
    int status,
    String code,
    String message, [
    List<Map<String, String>> fieldErrors = const [],
  ]) => http.Response(
    jsonEncode({
      'error': {
        'code': code,
        'message': message,
        if (fieldErrors.isNotEmpty) 'fieldErrors': fieldErrors,
      },
    }),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );

  Map<String, dynamic> _public(Map<String, dynamic> row) => {
    for (final entry in row.entries)
      if (!entry.key.startsWith('_')) entry.key: entry.value,
  };

  Map<String, dynamic> _detail(Map<String, dynamic> transfer) => {
    ..._public(transfer),
    'recipient': _public(
      recipients.firstWhere((r) => r['id'] == transfer['recipientId']),
    ),
    'timeline': _events[transfer['id']],
  };

  /// Test control: the provider reports [status] for a transfer.
  void setStatus(String transferId, String status) =>
      _setStatus(transfers.firstWhere((t) => t['id'] == transferId), status);

  void _setStatus(Map<String, dynamic> transfer, String status) {
    transfer['status'] = status;
    transfer['updatedAt'] = now.toIso8601String();
    _events[transfer['id']]!.add({
      'status': status,
      'occurredAt': now.toIso8601String(),
    });
  }

  List<Map<String, String>> _validate(
    Map<String, dynamic> form,
    Map<String, dynamic> values,
  ) {
    final errors = <Map<String, String>>[];
    for (final raw in form['fields'] as List<dynamic>) {
      final field = raw as Map<String, dynamic>;
      final key = field['key'] as String;
      final value = (values[key] as String? ?? '').trim();
      final validation = field['validation'] as Map<String, dynamic>;
      if (value.isEmpty) {
        if (field['required'] == true) {
          errors.add({
            'field': key,
            'message': '${field['label']} is required',
          });
        }
        continue;
      }
      final pattern = validation['pattern'] as String?;
      if (pattern != null && !RegExp(pattern).hasMatch(value)) {
        errors.add({'field': key, 'message': '${field['label']} is not valid'});
      }
    }
    return errors;
  }

  Future<http.Response> _handle(http.Request request) async {
    requests.add(request);
    final path = request.url.path;
    final route = '${request.method} $path';
    final drops = dropNext[route] ?? 0;
    final body = request.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(request.body) as Map<String, dynamic>;

    Map<String, dynamic>? transferAt(int segment) {
      final id = request.url.pathSegments[segment];
      return transfers.where((t) => t['id'] == id).firstOrNull;
    }

    if (route == 'GET /api/v1/currencies') {
      return _ok({
        'sourceCurrencies': ['GBP'],
        'targetCurrencies': ['EUR', 'USD', 'INR', 'MXN'],
        'currencies': [
          {'code': 'GBP', 'name': 'British pound', 'minorUnit': 2},
          {'code': 'EUR', 'name': 'Euro', 'minorUnit': 2},
          {'code': 'USD', 'name': 'US dollar', 'minorUnit': 2},
          {'code': 'INR', 'name': 'Indian rupee', 'minorUnit': 2},
          {'code': 'MXN', 'name': 'Mexican peso', 'minorUnit': 2},
        ],
        'provider': {
          'name': 'mock',
          'displayName': 'Mock Payments (test provider)',
        },
        'payoutCountries': {
          'EUR': ['DE', 'FR'],
          'USD': ['US'],
          'INR': ['IN'],
          'MXN': ['MX'],
        },
      });
    }

    if (route == 'POST /api/v1/quotes') {
      // Amounts must arrive as strings: a JSON number would be a float.
      final sourceAmount = body['sourceAmount'];
      final targetAmount = body['targetAmount'];
      if ((sourceAmount == null) == (targetAmount == null) ||
          (sourceAmount ?? targetAmount) is! String) {
        return _error(400, 'VALIDATION_ERROR', 'The request is invalid.');
      }
      final target = body['targetCurrency'] as String;
      final rate = _rates[target];
      if (rate == null) {
        return _error(422, 'ROUTE_NOT_SUPPORTED', 'We cannot send that.');
      }
      final int total;
      if (sourceAmount != null) {
        total = _toMinor(sourceAmount as String);
      } else {
        final wanted = _toMinor(targetAmount as String);
        total = (wanted * 100 + rate - 1) ~/ rate + 90;
      }
      if (total < 100) {
        return _error(400, 'VALIDATION_ERROR', 'The amount is too small.', [
          {'field': 'sourceAmount', 'message': 'Send at least 1.00 GBP'},
        ]);
      }
      return _ok(
        _quote(
          source: body['sourceCurrency'] as String,
          target: target,
          total: total,
          fee: 90,
        ),
        201,
      );
    }

    if (request.method == 'POST' &&
        path.startsWith('/api/v1/quotes/') &&
        path.endsWith('/recipient')) {
      final quote = _quotes[request.url.pathSegments[3]];
      final recipient = recipients
          .where((r) => r['id'] == body['recipientId'])
          .firstOrNull;
      if (quote == null || recipient == null) {
        return _error(404, 'NOT_FOUND', 'Not found.');
      }
      if (_expired(quote)) {
        return _error(409, 'QUOTE_EXPIRED', 'That quote has expired.');
      }
      if (recipient['_business'] != true) {
        return _ok({...quote, 'priceChanged': false});
      }
      final source = quote['source'] as Map<String, dynamic>;
      final target = quote['target'] as Map<String, dynamic>;
      final total = int.parse(
        (quote['totalToPay'] as Map)['amountMinor'] as String,
      );
      return _ok(
        _quote(
          source: source['currency'] as String,
          target: target['currency'] as String,
          total: total,
          fee: 140,
          priceChanged: true,
        ),
      );
    }

    if (route == 'GET /api/v1/recipients') {
      return _ok({'recipients': recipients.map(_public).toList()});
    }

    if (route == 'POST /api/v1/recipient-form') {
      final partial =
          (body['partialValues'] as Map<String, dynamic>?) ?? const {};
      return _ok(
        mockRecipientForm(
          body['currency'] as String,
          business: partial['legalType'] == 'BUSINESS',
        ),
      );
    }

    if (route == 'POST /api/v1/recipients') {
      final values = body['values'] as Map<String, dynamic>;
      final business = values['legalType'] == 'BUSINESS';
      final errors = _validate(
        mockRecipientForm(body['currency'] as String, business: business),
        values,
      );
      if (errors.isNotEmpty) {
        return _error(
          400,
          'VALIDATION_ERROR',
          'The payment provider did not accept those details.',
          errors,
        );
      }
      final name = values['accountHolderName'] as String;
      final recipient = addSavedRecipient(
        currency: body['currency'] as String,
        country: body['country'] as String,
        name: (body['displayName'] as String?) ?? name,
        business: business,
      )..['accountHolderName'] = name;
      return _ok(_public(recipient), 201);
    }

    if (request.method == 'DELETE' && path.startsWith('/api/v1/recipients/')) {
      // Soft delete: kept for history, no longer listed.
      final id = request.url.pathSegments[3];
      recipients.where((r) => r['id'] == id).forEach((r) {
        r['isActive'] = false;
        r['_removed'] = true;
      });
      return _ok({'status': 'removed'});
    }

    if (route == 'POST /api/v1/transfer-form') {
      final quote = _quotes[body['quoteId']];
      if (quote == null) return _error(404, 'NOT_FOUND', 'Not found.');
      if (_expired(quote)) {
        return _error(409, 'QUOTE_EXPIRED', 'That quote has expired.');
      }
      return _ok(
        mockTransferForm((quote['target'] as Map)['currency'] as String),
      );
    }

    if (route == 'POST /api/v1/transfers') {
      final key = request.headers['idempotency-key'];
      if (key == null ||
          !RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ).hasMatch(key)) {
        return _error(400, 'VALIDATION_ERROR', 'A UUID key is required.');
      }
      Map<String, dynamic>? existing = transfers
          .where((t) => t['_key'] == key || t['_quoteId'] == body['quoteId'])
          .firstOrNull;
      if (existing == null) {
        final quote = _quotes[body['quoteId']];
        if (quote == null) return _error(404, 'NOT_FOUND', 'Not found.');
        if (_expired(quote)) {
          return _error(
            409,
            'QUOTE_EXPIRED',
            'That quote has expired. Please get a new one.',
          );
        }
        final total = int.parse(
          (quote['totalToPay'] as Map)['amountMinor'] as String,
        );
        if (total > perTransferLimit) {
          return _error(
            422,
            'LIMIT_EXCEEDED',
            'You can send up to ${_money('GBP', perTransferLimit)['amount']} GBP in one transfer.',
            [
              {'field': 'limit', 'message': 'PER_TRANSFER'},
            ],
          );
        }
        final errors = _validate(
          mockTransferForm((quote['target'] as Map)['currency'] as String),
          (body['answers'] as Map<String, dynamic>?) ?? const {},
        );
        if (errors.isNotEmpty) {
          return _error(
            400,
            'VALIDATION_ERROR',
            'The payment provider did not accept those details.',
            errors,
          );
        }
        final id = 't-${++_ids}';
        providerTransfers++;
        existing = {
          'id': id,
          'reference': 'ALM-$id',
          'status': 'AWAITING_FUNDS',
          'source': quote['source'],
          'fee': quote['fee'],
          'totalToPay': quote['totalToPay'],
          'target': quote['target'],
          'exchangeRate': quote['exchangeRate'],
          'recipientId': body['recipientId'],
          'recipientReference': body['reference'],
          'provider': {
            'name': 'mock',
            'displayName': 'Mock Payments (test provider)',
          },
          'fundingMethod': null,
          'failureReason': null,
          'createdAt': now.toIso8601String(),
          'updatedAt': now.toIso8601String(),
          '_key': key,
          '_quoteId': body['quoteId'],
        };
        transfers.insert(0, existing);
        _events[id] = [
          {'status': 'DRAFT', 'occurredAt': now.toIso8601String()},
          {'status': 'AWAITING_FUNDS', 'occurredAt': now.toIso8601String()},
        ];
        if (drops > 0) {
          // The transfer was created, but the answer never reached the app.
          dropNext[route] = drops - 1;
          throw http.ClientException('connection lost');
        }
        return _ok(_public(existing), 201);
      }
      return _ok(_public(existing));
    }

    if (drops > 0) {
      dropNext[route] = drops - 1;
      throw http.ClientException('connection lost');
    }

    if (route == 'GET /api/v1/transfers') {
      final page = int.parse(request.url.queryParameters['page'] ?? '1');
      final size = int.parse(request.url.queryParameters['pageSize'] ?? '20');
      final slice = transfers.skip((page - 1) * size).take(size + 1).toList();
      return _ok({
        'transfers': slice.take(size).map(_public).toList(),
        'page': page,
        'pageSize': size,
        'hasMore': slice.length > size,
      });
    }

    if (request.method == 'POST' && path.startsWith('/dev/mock/transfers/')) {
      final transfer = transferAt(3);
      if (transfer == null) return _error(404, 'NOT_FOUND', 'Not found.');
      final next = _mockStatuses.indexOf(transfer['status'] as String) + 1;
      if (next > 0 && next < _mockStatuses.length) {
        _setStatus(transfer, _mockStatuses[next]);
      }
      return _ok({'id': transfer['id'], 'status': transfer['status']});
    }

    if (path.startsWith('/api/v1/transfers/')) {
      final transfer = transferAt(3);
      if (transfer == null) return _error(404, 'NOT_FOUND', 'Not found.');
      final action = request.url.pathSegments.length > 4
          ? request.url.pathSegments[4]
          : '';
      final awaiting = transfer['status'] == 'AWAITING_FUNDS';
      switch ('${request.method} $action') {
        case 'GET ':
          return _ok(_detail(transfer));
        case 'POST refresh':
          return _ok(_public(transfer));
        case 'POST cancel':
          if (!awaiting) {
            return _error(409, 'CONFLICT', 'It can no longer be cancelled.');
          }
          _setStatus(transfer, 'CANCELLED');
          return _ok(_public(transfer));
        case 'GET funding':
          if (!awaiting) {
            return _error(409, 'CONFLICT', 'Not waiting for payment.');
          }
          return _ok({
            'transferId': transfer['id'],
            'provider': transfer['provider'],
            'methods': [
              {
                'method': 'BANK_TRANSFER',
                'amount': transfer['totalToPay'],
                'bankDetails': [
                  {
                    'label': 'Account holder',
                    'value': 'Mock Payments Ltd (sandbox)',
                  },
                  {'label': 'Sort code', 'value': '00-00-00'},
                  {'label': 'Account number', 'value': '00000000'},
                ],
                'reference': 'MOCK1A2B3C4D',
              },
              {'method': 'BALANCE', 'amount': transfer['totalToPay']},
            ],
          });
        case 'POST fund':
          if (!awaiting) {
            return _error(409, 'CONFLICT', 'Not waiting for payment.');
          }
          final total = int.parse(
            (transfer['totalToPay'] as Map)['amountMinor'] as String,
          );
          if (body['method'] == 'BANK_TRANSFER') {
            transfer['fundingMethod'] = 'BANK_TRANSFER';
            return _ok({
              'outcome': 'AWAITING_PAYMENT',
              'message': 'Mock Payments is waiting for your payment.',
              'transfer': _public(transfer),
            });
          }
          if (total > scaAbove) {
            return _ok({
              'outcome': 'SCA_REQUIRED',
              'message': 'Mock Payments needs you to approve this payment. Open your account, approve it, then come back and check again.',
              'transfer': _public(transfer),
            });
          }
          transfer['fundingMethod'] = 'BALANCE';
          _setStatus(transfer, 'PROCESSING');
          return _ok({
            'outcome': 'FUNDED',
            'message': null,
            'transfer': _public(transfer),
          });
      }
    }

    return _error(404, 'NOT_FOUND', 'No such route: $route');
  }
}
