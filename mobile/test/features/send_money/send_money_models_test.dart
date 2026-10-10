import 'package:almapay/features/send_money/data/send_money_api.dart';
import 'package:almapay/features/send_money/data/send_money_repository_impl.dart';
import 'package:almapay/features/send_money/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_send_money_backend.dart';

SendMoneyApi _api(FakeSendMoneyBackend backend) => SendMoneyApi(
  baseUrl: Uri.parse('https://api.test/'),
  client: backend.client,
);

void main() {
  group('TransferStatus', () {
    test('parses every backend status', () {
      const wire = {
        'DRAFT': TransferStatus.draft,
        'AWAITING_FUNDS': TransferStatus.awaitingFunds,
        'PROCESSING': TransferStatus.processing,
        'SENT': TransferStatus.sent,
        'COMPLETED': TransferStatus.completed,
        'CANCELLED': TransferStatus.cancelled,
        'REFUNDED': TransferStatus.refunded,
        'FAILED': TransferStatus.failed,
      };
      wire.forEach((value, expected) {
        expect(TransferStatus.fromWire(value), expected);
      });
    });

    test('an unrecognised status is shown as unknown, never guessed', () {
      expect(TransferStatus.fromWire('completed'), TransferStatus.unknown);
      expect(TransferStatus.fromWire('SOMETHING_NEW'), TransferStatus.unknown);
    });

    test('only unfunded transfers are cancellable; SENT is not settled', () {
      expect(TransferStatus.draft.isCancellable, isTrue);
      expect(TransferStatus.awaitingFunds.isCancellable, isTrue);
      expect(TransferStatus.processing.isCancellable, isFalse);
      expect(TransferStatus.sent.isSettled, isFalse);
      expect(TransferStatus.completed.isSettled, isTrue);
    });
  });

  group('amounts are text, never floating point', () {
    CurrencyInfo currency(int minorUnit) =>
        CurrencyInfo(code: 'XXX', name: 'Test', minorUnit: minorUnit);

    test('decimal places follow the currency the provider described', () {
      expect(currency(2).validateAmount('100'), isNull);
      expect(currency(2).validateAmount('100.5'), isNull);
      expect(currency(2).validateAmount('100.55'), isNull);
      expect(currency(2).validateAmount('100.555'), contains('2 decimal'));
      expect(currency(0).validateAmount('1500'), isNull);
      expect(currency(0).validateAmount('1500.5'), contains('whole amount'));
      expect(currency(3).validateAmount('1.234'), isNull);
      expect(currency(3).validateAmount('1.2345'), contains('3 decimal'));
    });

    test('anything that is not a plain positive decimal is refused', () {
      for (final bad in [
        '',
        'abc',
        '-5',
        '1e3',
        '1,000.00',
        '.5',
        '5.',
        '0',
        '0.00',
      ]) {
        expect(currency(2).validateAmount(bad), isNotNull, reason: '"$bad"');
      }
    });

    test('a quote keeps the backend figures as strings', () async {
      final backend = FakeSendMoneyBackend();
      final quote = await _api(backend).createQuote(
        sourceCurrency: 'GBP',
        targetCurrency: 'EUR',
        sourceAmount: '100.10',
      );
      // What is sent is exactly what was typed, as a JSON string.
      expect(backend.lastBody('POST', '/api/v1/quotes'), {
        'sourceCurrency': 'GBP',
        'targetCurrency': 'EUR',
        'sourceAmount': '100.10',
      });
      expect(backend.last('POST', '/api/v1/quotes').body, contains('"100.10"'));
      expect(quote.totalToPay.label, '100.10 GBP');
      expect(quote.fee.minorUnits, '90');
      expect(quote.target.display, isA<String>());
      expect(quote.exchangeRate, '1.17');
    });

    test('a quote can be asked for by the amount the recipient gets', () async {
      final backend = FakeSendMoneyBackend();
      final quote = await _api(backend).createQuote(
        sourceCurrency: 'GBP',
        targetCurrency: 'EUR',
        targetAmount: '117.00',
      );
      expect(backend.lastBody('POST', '/api/v1/quotes'), {
        'sourceCurrency': 'GBP',
        'targetCurrency': 'EUR',
        'targetAmount': '117.00',
      });
      expect(quote.target.display, '117.00');
    });
  });

  group('quote expiry', () {
    test('seconds left never go negative', () {
      final quote = Quote.fromJson({
        'id': 'q',
        'source': {'currency': 'GBP', 'amount': '1.00', 'amountMinor': '100'},
        'fee': {'currency': 'GBP', 'amount': '0.10', 'amountMinor': '10'},
        'totalToPay': {
          'currency': 'GBP',
          'amount': '1.10',
          'amountMinor': '110',
        },
        'target': {'currency': 'EUR', 'amount': '1.17', 'amountMinor': '117'},
        'exchangeRate': '1.17',
        'estimatedDelivery': null,
        'expiresAt': '2026-10-03T12:30:00.000Z',
      });
      expect(quote.secondsLeft(DateTime.utc(2026, 10, 3, 12, 29, 15)), 45);
      expect(quote.secondsLeft(DateTime.utc(2026, 10, 3, 12, 31)), 0);
      expect(quote.priceChanged, isFalse);
    });
  });

  group('API', () {
    test(
      'uses the provider-neutral endpoints and sends only what is needed',
      () async {
        final backend = FakeSendMoneyBackend();
        final api = _api(backend);
        final recipient = backend.addSavedRecipient();
        final quote = await api.createQuote(
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: '100.00',
        );

        final currencies = await api.getCurrencies();
        expect(currencies.providerDisplayName, 'Mock Payments (test provider)');
        expect(currencies.info('EUR')?.name, 'Euro');
        expect(currencies.payoutCountries['EUR'], ['DE', 'FR']);

        await api.getRecipientForm(
          currency: 'EUR',
          country: 'DE',
          partialValues: {'legalType': 'BUSINESS'},
        );
        expect(backend.lastBody('POST', '/api/v1/recipient-form'), {
          'currency': 'EUR',
          'country': 'DE',
          'partialValues': {'legalType': 'BUSINESS'},
        });

        final priced = await api.attachRecipient(
          quoteId: quote.id,
          recipientId: recipient['id'] as String,
        );
        expect(priced.priceChanged, isFalse);
        await api.getTransferForm(
          quoteId: quote.id,
          recipientId: recipient['id'] as String,
        );
        expect(backend.count('POST', '/api/v1/transfer-form'), 1);

        final key = newIdempotencyKey();
        final transfer = await api.createTransfer(
          quoteId: quote.id,
          recipientId: recipient['id'] as String,
          answers: {'purpose': 'gift'},
          idempotencyKey: key,
          reference: 'Rent March',
        );
        // No fee, rate, amount or status travels from the app.
        expect(backend.lastBody('POST', '/api/v1/transfers'), {
          'quoteId': quote.id,
          'recipientId': recipient['id'],
          'answers': {'purpose': 'gift'},
          'reference': 'Rent March',
        });
        expect(
          backend.last('POST', '/api/v1/transfers').headers['idempotency-key'],
          key,
        );
        expect(transfer.recipientReference, 'Rent March');
        expect(transfer.providerName, 'mock');

        final funding = await api.getFunding(transfer.id);
        expect(funding.providerDisplayName, 'Mock Payments (test provider)');
        expect(funding.bankTransfer?.reference, 'MOCK1A2B3C4D');
        expect(funding.bankTransfer?.amount, transfer.totalToPay);
        expect(funding.balance, isNotNull);

        final paid = await api.fund(transfer.id, 'BALANCE');
        expect(paid.outcome, 'FUNDED');
        expect(paid.transfer.status, TransferStatus.processing);

        final detail = await api.getTransfer(transfer.id);
        expect(detail.timeline.map((e) => e.status), [
          TransferStatus.draft,
          TransferStatus.awaitingFunds,
          TransferStatus.processing,
        ]);
        expect(detail.recipient?.accountSummary, 'IBAN ••••3000');

        final page = await api.listTransfers(page: 1);
        expect(page.transfers.single.id, transfer.id);
        expect(page.hasMore, isFalse);
        expect(
          backend.last('GET', '/api/v1/transfers').url.query,
          'page=1&pageSize=20',
        );

        await api.deleteRecipient(recipient['id'] as String);
        expect(
          backend.count('DELETE', '/api/v1/recipients/${recipient['id']}'),
          1,
        );
      },
    );

    test('idempotency keys are UUID v4 and different every time', () {
      final keys = {for (var i = 0; i < 50; i++) newIdempotencyKey()};
      expect(keys.length, 50);
      for (final key in keys) {
        expect(
          key,
          matches(
            RegExp(
              r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            ),
          ),
        );
      }
    });
  });
}
