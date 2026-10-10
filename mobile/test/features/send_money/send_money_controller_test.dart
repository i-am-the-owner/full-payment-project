import 'package:almapay/features/send_money/data/send_money_api.dart';
import 'package:almapay/features/send_money/data/send_money_repository_impl.dart';
import 'package:almapay/features/send_money/domain/models.dart';
import 'package:almapay/features/send_money/presentation/send_money_controller.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_send_money_backend.dart';

SendMoneyController _controller(FakeSendMoneyBackend backend) =>
    SendMoneyController(
      SendMoneyRepositoryImpl(
        api: SendMoneyApi(
          baseUrl: Uri.parse('https://api.test/'),
          client: backend.client,
        ),
      ),
    );

/// Amount → quote → saved recipient → answers, ready to confirm.
Future<SendMoneyController> _atReview(
  FakeSendMoneyBackend backend, {
  String amount = '100.00',
  bool business = false,
}) async {
  final recipient = backend.addSavedRecipient(business: business);
  final c = _controller(backend);
  await c.loadCurrencies();
  c.setAmount(AmountSide.send, amount);
  await c.updateQuote();
  await c.continueToRecipient();
  await c.selectRecipient(
    c.recipients.firstWhere((r) => r.id == recipient['id']),
  );
  c.submitAnswers({'purpose': 'family_support'});
  return c;
}

void main() {
  test(
    'choosing another country shows no old rate, then that pair\'s rate',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = _controller(backend);
      await c.loadIndicativeRate();
      final other = c.targetCurrencies.firstWhere(
        (code) => code != c.targetCurrency && code != c.sourceCurrency,
      );

      c.setTargetCurrency(other);
      expect(c.indicativeRate, isNull);

      await c.loadIndicativeRate();
      expect(c.indicativeRate, endsWith(' $other'));
    },
  );

  test(
    'the home ticket gets a rate from the backend and forgets it on sign-out',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = _controller(backend);
      expect(c.indicativeRate, isNull);

      await c.loadIndicativeRate();

      expect(
        c.indicativeRate,
        matches(RegExp(r'^1 [A-Z]{3} = [0-9.]+ [A-Z]{3}$')),
      );
      c.clearCustomerData();
      expect(c.indicativeRate, isNull);
    },
  );

  test(
    'clearing the customer data drops their people and half-made transfer',
    () async {
      final backend = FakeSendMoneyBackend();
      backend.addSavedRecipient();
      final c = _controller(backend);
      await c.loadCurrencies();
      c.setAmount(AmountSide.send, '100.00');
      await c.updateQuote();
      await c.loadRecipients();
      expect(c.recipients, isNotEmpty);
      expect(c.quote, isNotNull);

      c.clearCustomerData();

      expect(c.recipients, isEmpty);
      expect(c.quote, isNull);
      expect(c.amount, isEmpty);
    },
  );

  test(
    'currencies, names and decimals come from the backend, not the app',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = _controller(backend);
      expect(c.sourceCurrencies, isEmpty);

      await c.loadCurrencies();
      expect(c.sourceCurrencies, ['GBP']);
      expect(c.targetCurrencies, ['EUR', 'USD', 'INR', 'MXN']);
      expect(c.sourceCurrency, 'GBP');
      expect(c.targetCurrency, 'EUR');
      expect(c.providerName, 'Mock Payments (test provider)');
      expect(c.payoutCountries, ['DE', 'FR']);
    },
  );

  test('either amount can be typed; the other comes from the quote', () async {
    final backend = FakeSendMoneyBackend();
    final c = _controller(backend);
    await c.loadCurrencies();

    c.setAmount(AmountSide.send, ' 100.00 ');
    expect(await c.updateQuote(), isTrue);
    expect(c.quote!.totalToPay.display, '100.00');
    expect(c.quote!.target.display, '115.94');

    c.setAmount(AmountSide.receive, '117.00');
    expect(c.quote, isNull); // the old quote is not shown for a new amount
    expect(await c.updateQuote(), isTrue);
    expect(
      backend.lastBody('POST', '/api/v1/quotes')['targetAmount'],
      '117.00',
    );
    expect(c.quote!.target.display, '117.00');
    expect(c.quote!.totalToPay.display, '100.90');
  });

  test('an amount with too many decimals is not sent to the backend', () async {
    final backend = FakeSendMoneyBackend();
    final c = _controller(backend);
    await c.loadCurrencies();
    c.setAmount(AmountSide.send, '10.999');
    expect(c.amountProblem, contains('2 decimal places'));
    expect(await c.updateQuote(), isFalse);
    expect(backend.count('POST', '/api/v1/quotes'), 0);
  });

  test('changing a currency drops the quote and fetches a new one', () async {
    final backend = FakeSendMoneyBackend();
    final c = _controller(backend);
    await c.loadCurrencies();
    c.setAmount(AmountSide.send, '100.00');
    await c.updateQuote();
    c.setTargetCurrency('USD');
    expect(c.quote, isNull);
    await Future<void>.delayed(Duration.zero);
    expect(c.quote!.target.currency, 'USD');
  });

  test(
    'the whole flow: quote, recipient, questions, review, pay, status',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = await _atReview(backend);
      expect(c.stage, SendMoneyStage.review);
      expect(c.transferForm!.fields.single.key, 'purpose');

      c.setReference(' Rent March ');
      await c.confirm();
      expect(c.error, isNull);
      expect(c.stage, SendMoneyStage.pay);
      expect(c.transfer!.status, TransferStatus.awaitingFunds);
      expect(c.transfer!.recipientReference, 'Rent March');
      expect(c.funding!.bankTransfer!.reference, 'MOCK1A2B3C4D');

      await c.pay('BANK_TRANSFER');
      expect(c.stage, SendMoneyStage.status);
      expect(c.transfer!.status, TransferStatus.awaitingFunds);
      expect(c.transfer!.timeline, isNotEmpty);

      // The provider moves it on; the app only reads the result.
      for (final expected in [
        TransferStatus.processing,
        TransferStatus.sent,
        TransferStatus.completed,
      ]) {
        await c.simulateProviderStep();
        expect(c.transfer!.status, expected);
      }
      expect(c.transfer!.timeline.map((e) => e.status), [
        TransferStatus.draft,
        TransferStatus.awaitingFunds,
        TransferStatus.processing,
        TransferStatus.sent,
        TransferStatus.completed,
      ]);
      expect(backend.providerTransfers, 1);
    },
  );

  test(
    'tapping Confirm twice sends one request and creates one transfer',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = await _atReview(backend);

      await Future.wait([c.confirm(), c.confirm(), c.confirm()]);

      expect(backend.count('POST', '/api/v1/transfers'), 1);
      expect(backend.providerTransfers, 1);
      expect(backend.transfers.length, 1);
    },
  );

  test('a retry after a lost answer reuses the same key and finds the same transfer', () async {
    final backend = FakeSendMoneyBackend();
    backend.dropNext['POST /api/v1/transfers'] = 1;
    final c = await _atReview(backend);

    await c.confirm();
    expect(c.error, contains('Could not reach AaminPay'));
    expect(c.stage, SendMoneyStage.review);
    expect(c.transfer, isNull);
    // The backend did create it; the app just never heard.
    expect(backend.providerTransfers, 1);

    await c.confirm();
    expect(c.error, isNull);
    expect(c.stage, SendMoneyStage.pay);
    final sent = backend.requests
        .where((r) => r.method == 'POST' && r.url.path == '/api/v1/transfers')
        .map((r) => r.headers['idempotency-key'])
        .toList();
    expect(sent.length, 2);
    expect(sent[0], sent[1]);
    expect(backend.providerTransfers, 1);
    expect(backend.transfers.length, 1);
  });

  test('an expired quote cannot be confirmed; the customer gets a new one to check', () async {
    final backend = FakeSendMoneyBackend();
    final c = await _atReview(backend);
    final stale = c.quote!;

    backend.now = backend.now.add(const Duration(minutes: 31));
    await c.confirm();
    expect(c.error, contains('expired'));
    expect(c.transfer, isNull);
    expect(backend.providerTransfers, 0);
    expect(c.stage, SendMoneyStage.review);

    // The countdown's expiry handler: a new quote, priced for the recipient.
    await c.renewQuote();
    expect(c.quote!.id, isNot(stale.id));
    expect(c.stage, SendMoneyStage.review);
    await c.confirm();
    expect(c.stage, SendMoneyStage.pay);
    expect(backend.providerTransfers, 1);
  });

  test(
    'a price that changes for the recipient is shown before confirming',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = await _atReview(backend, business: true);
      expect(c.quote!.priceChanged, isTrue);
      expect(c.quote!.fee.display, '1.40');
      expect(c.notice, contains('price changed for this recipient'));

      await c.confirm();
      expect(c.transfer!.fee.display, '1.40');
    },
  );

  test(
    'a limit is explained in the backend’s words and nothing is created',
    () async {
      final backend = FakeSendMoneyBackend()..perTransferLimit = 5000;
      final c = await _atReview(backend);
      await c.confirm();
      expect(c.error, 'You can send up to 50.00 GBP in one transfer.');
      expect(c.stage, SendMoneyStage.review);
      expect(backend.providerTransfers, 0);
    },
  );

  test(
    'paying from balance moves on at once; needing approval says what to do',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = await _atReview(backend);
      await c.confirm();
      await c.pay('BALANCE');
      expect(c.stage, SendMoneyStage.status);
      expect(c.transfer!.status, TransferStatus.processing);
      expect(c.transfer!.fundingMethod, 'BALANCE');

      final big = FakeSendMoneyBackend()..scaAbove = 5000;
      final c2 = await _atReview(big);
      await c2.confirm();
      await c2.pay('BALANCE');
      expect(c2.stage, SendMoneyStage.pay);
      expect(c2.notice, contains('approve this payment'));
      expect(c2.transfer!.status, TransferStatus.awaitingFunds);
    },
  );

  test('a transfer can be cancelled only while it waits for payment', () async {
    final backend = FakeSendMoneyBackend();
    final c = await _atReview(backend);
    await c.confirm();
    await c.cancelTransfer();
    expect(c.transfer!.status, TransferStatus.cancelled);
    expect(c.stage, SendMoneyStage.status);

    final c2 = await _atReview(FakeSendMoneyBackend());
    await c2.confirm();
    await c2.pay('BALANCE');
    await c2.cancelTransfer();
    expect(c2.error, contains('no longer be cancelled'));
    expect(c2.transfer!.status, TransferStatus.processing);
  });

  test(
    'recipients: only those for the currency are offered; removal is immediate',
    () async {
      final backend = FakeSendMoneyBackend();
      backend.addSavedRecipient(name: 'Anna');
      backend.addSavedRecipient(currency: 'USD', country: 'US', name: 'John');
      final c = _controller(backend);
      await c.loadCurrencies();
      c.setAmount(AmountSide.send, '100.00');
      await c.updateQuote();
      await c.continueToRecipient();

      expect(c.matchingRecipients.map((r) => r.displayName), ['Anna']);
      await c.removeRecipient(c.matchingRecipients.single);
      expect(c.matchingRecipients, isEmpty);
      expect(backend.recipients.first['isActive'], isFalse);
    },
  );

  test(
    'the provider’s field errors for a new recipient are kept by field',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = _controller(backend);
      await c.loadCurrencies();
      c.setAmount(AmountSide.send, '100.00');
      await c.updateQuote();
      await c.continueToRecipient();

      final created = await c.addRecipient(
        const NewRecipient(
          currency: 'EUR',
          country: 'DE',
          values: {
            'legalType': 'PRIVATE',
            'accountHolderName': 'Anna',
            'iban': 'nope',
          },
        ),
      );
      expect(created, isNull);
      expect(c.fieldErrors, {'iban': 'IBAN is not valid'});
      expect(c.error, contains('did not accept'));
    },
  );

  test(
    'going back walks the steps; after confirming there is no way back',
    () async {
      final backend = FakeSendMoneyBackend();
      final c = await _atReview(backend);
      expect(c.back(), isTrue);
      expect(c.stage, SendMoneyStage.questions);
      expect(c.back(), isTrue);
      expect(c.stage, SendMoneyStage.recipient);
      expect(c.back(), isTrue);
      expect(c.stage, SendMoneyStage.amount);
      expect(c.back(), isFalse);

      final c2 = await _atReview(FakeSendMoneyBackend());
      await c2.confirm();
      expect(c2.back(), isFalse);
      expect(c2.stage, SendMoneyStage.pay);
    },
  );

  test('status reloads quietly and survives a dropped connection', () async {
    final backend = FakeSendMoneyBackend();
    final c = await _atReview(backend);
    await c.confirm();
    await c.pay('BANK_TRANSFER');
    final id = c.transfer!.id;

    backend.dropNext['GET /api/v1/transfers/$id'] = 1;
    await c.reloadTransfer(quiet: true);
    expect(c.error, isNull);
    expect(c.transfer!.status, TransferStatus.awaitingFunds);

    // A webhook arrived at the backend in the meantime.
    await backend.client.post(
      Uri.parse('https://api.test/dev/mock/transfers/$id/advance'),
    );
    await c.reloadTransfer(quiet: true);
    expect(c.transfer!.status, TransferStatus.processing);
  });
}
