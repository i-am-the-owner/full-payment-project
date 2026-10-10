import 'package:almapay/features/send_money/data/send_money_api.dart';
import 'package:almapay/features/send_money/data/send_money_repository_impl.dart';
import 'package:almapay/features/send_money/presentation/send_money_controller.dart';
import 'package:almapay/features/send_money/presentation/send_money_flow_page.dart';
import 'package:almapay/features/send_money/presentation/transfer_history_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

/// The two screens the full flow is exercised on.
const _viewports = [
  (name: 'a 375px phone', size: Size(375, 667)),
  (name: 'a 1280px desktop window', size: Size(1280, 800)),
];

/// The size the current test runs at; every other test stays on a 375px phone.
Size _viewportSize = const Size(375, 667);

/// Every screen test runs on a 375px-wide phone unless it chooses another size. A layout that does not fit
/// fails the test (Flutter reports the overflow as an error).
void _phone(WidgetTester tester, {double? height}) {
  tester.view.physicalSize = Size(
    _viewportSize.width,
    height ?? _viewportSize.height,
  );
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<SendMoneyController> _open(
  WidgetTester tester,
  FakeSendMoneyBackend backend, {
  bool devTools = true,
}) async {
  _phone(tester);
  final controller = _controller(backend);
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              key: const Key('open_flow'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => SendMoneyFlowPage(
                    controller: controller,
                    devTools: devTools,
                    now: () => backend.now,
                  ),
                ),
              ),
              child: const Text('Send money'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const Key('open_flow')));
  await tester.pumpAndSettle();
  return controller;
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) =>
    _tap(tester, find.byKey(Key(key)));

Future<void> _type(WidgetTester tester, String key, String text) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.enterText(finder, text);
  // Longer than the typing pause the amount screen waits for.
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pumpAndSettle();
}

String _text(WidgetTester tester, String key) =>
    tester.widget<TextField>(find.byKey(Key(key))).controller!.text;

void main() {
  setUp(() => _viewportSize = const Size(375, 667));
  for (final viewport in _viewports) {
    testWidgets(
      'the full flow on ${viewport.name}: amount to COMPLETED with the mock provider',
      (tester) async {
        _viewportSize = viewport.size;
        final backend = FakeSendMoneyBackend();
        await _open(tester, backend);

        // 1. Amount: type what you send; the provider's figures fill in the rest.
        expect(find.byKey(const Key('amount_send')), findsOneWidget);
        expect(
          tester
              .widget<FilledButton>(
                find.descendant(
                  of: find.byKey(const Key('amount_continue')),
                  matching: find.byType(FilledButton),
                ),
              )
              .onPressed,
          isNull,
        );
        await _type(tester, 'amount_send', '100.00');
        expect(_text(tester, 'amount_receive'), '115.94');
        expect(find.text('0.90 GBP'), findsOneWidget); // fee
        expect(find.text('1 GBP = 1.17 EUR'), findsOneWidget); // live rate
        expect(find.text('100.00 GBP'), findsOneWidget); // total
        expect(find.text('Should arrive by'), findsOneWidget);
        expect(find.text('Rate guaranteed for 30:00'), findsOneWidget);

        // ...or type what they receive.
        await _type(tester, 'amount_receive', '117.00');
        expect(_text(tester, 'amount_send'), '100.90');
        await _type(tester, 'amount_send', '100.00');
        await _tapKey(tester, 'amount_continue');

        // 2. Recipient: none saved, so add one with the provider's own form.
        expect(find.text('Who are you sending to?'), findsOneWidget);
        await _tapKey(tester, 'recipient_add');
        await _tapKey(tester, 'recipient_country');
        await _tap(tester, find.text('DE').last);
        await _tapKey(tester, 'field_legalType_PRIVATE');
        await _type(tester, 'field_accountHolderName', 'Anna Schmidt');
        await _type(tester, 'field_iban', 'DE89370400440532013000');
        await _tapKey(tester, 'recipient_save');
        // The bank details went to the provider (via the backend) once.
        expect(backend.lastBody('POST', '/api/v1/recipients')['values'], {
          'legalType': 'PRIVATE',
          'accountHolderName': 'Anna Schmidt',
          'iban': 'DE89370400440532013000',
        });

        // 3. Extra questions.
        expect(find.text('A few questions'), findsOneWidget);
        await _tapKey(tester, 'questions_continue');
        expect(find.text('Enter the purpose of the transfer'), findsOneWidget);
        await _tapKey(tester, 'field_purpose');
        await _tap(tester, find.text('Family support').last);
        await _tapKey(tester, 'questions_continue');

        // 4. Review: every number, the recipient, then confirm.
        expect(find.text('Check your transfer'), findsOneWidget);
        expect(find.text('You send'), findsOneWidget);
        expect(find.text('Anna Schmidt gets'), findsOneWidget);
        expect(find.text('100.00 GBP'), findsOneWidget); // total to pay
        expect(find.text('115.94 EUR'), findsOneWidget); // on the ticket
        expect(find.text('0.90 GBP'), findsOneWidget);
        expect(find.text('1 GBP = 1.17 EUR'), findsOneWidget);
        expect(find.text('IBAN ••••3000'), findsOneWidget);
        expect(find.text('Family support'), findsOneWidget);
        expect(
          find.textContaining('goes directly to them, not to AaminPay'),
          findsOneWidget,
        );
        await _type(tester, 'review_reference', 'Rent March');
        await _tapKey(tester, 'review_confirm');
        expect(backend.providerTransfers, 1);

        // 5. Pay: the provider's details, with copy buttons.
        expect(find.byKey(const Key('pay_total')), findsOneWidget);
        expect(
          find.textContaining(
            'Your money goes directly to Mock Payments (test provider)',
          ),
          findsOneWidget,
        );
        expect(
          find.textContaining('AaminPay never holds your money'),
          findsOneWidget,
        );
        // The required statement: who provides the payment, and that AaminPay
        // holds no customer funds.
        expect(
          find.textContaining(
            'Payments are provided by Mock Payments (test provider). '
            'AaminPay does not hold customer funds.',
          ),
          findsOneWidget,
        );
        expect(find.text('Mock Payments Ltd (sandbox)'), findsOneWidget);
        expect(find.text('00-00-00'), findsOneWidget);
        expect(find.text('MOCK1A2B3C4D'), findsOneWidget);

        String? copied;
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          (call) async {
            if (call.method == 'Clipboard.setData') {
              copied = (call.arguments as Map)['text'] as String?;
            }
            return null;
          },
        );
        await _tap(tester, find.byTooltip('Copy reference'));
        expect(copied, 'MOCK1A2B3C4D');
        expect(find.text('Reference copied'), findsOneWidget);
        await _tap(tester, find.byTooltip('Copy amount'));
        expect(copied, '100.00');
        // Let the "copied" message go away before carrying on.
        await tester.pump(const Duration(seconds: 5));
        await tester.pumpAndSettle();

        await _tapKey(tester, 'pay_bank_done');

        // 6. Status: the timeline follows the provider.
        expect(find.text('Waiting for your money'), findsOneWidget);
        expect(find.text('WAITING FOR YOUR MONEY'), findsOneWidget);
        expect(find.byKey(const Key('transfer_timeline')), findsOneWidget);
        expect(find.text('Rent March'), findsOneWidget);
        for (final headline in [
          'Your transfer is being processed',
          'Your money is on its way',
          'Your money has been delivered',
        ]) {
          await _tapKey(tester, 'dev_simulate');
          expect(find.text(headline.toUpperCase()), findsOneWidget);
        }
        expect(find.text('Delivered'), findsOneWidget);
        // Finished: nothing left to pay, cancel or simulate.
        expect(find.byKey(const Key('dev_simulate')), findsNothing);
        expect(find.byKey(const Key('status_cancel')), findsNothing);
        expect(find.byKey(const Key('status_how_to_pay')), findsNothing);
        expect(backend.transfers.single['status'], 'COMPLETED');
        expect(backend.providerTransfers, 1);

        await _tapKey(tester, 'status_done');
        expect(find.byKey(const Key('open_flow')), findsOneWidget);
      },
    );
  }

  testWidgets('the status screen picks up webhook updates by itself', (
    tester,
  ) async {
    final backend = FakeSendMoneyBackend();
    backend.addSavedRecipient();
    await _open(tester, backend);
    await _type(tester, 'amount_send', '50.00');
    await _tapKey(tester, 'amount_continue');
    await _tap(tester, find.text('Anna Schmidt'));
    await _tapKey(tester, 'field_purpose');
    await _tap(tester, find.text('Gift').last);
    await _tapKey(tester, 'questions_continue');
    await _tapKey(tester, 'review_confirm');
    await _tapKey(tester, 'pay_bank_done');
    expect(find.text('Waiting for your money'), findsOneWidget);
    expect(find.text('WAITING FOR YOUR MONEY'), findsOneWidget);

    // The provider's webhook reaches the backend; nobody touches the app.
    final id = backend.transfers.single['id'];
    await tester.runAsync(
      () => backend.client.post(
        Uri.parse('https://api.test/dev/mock/transfers/$id/advance'),
      ),
    );
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(find.text('YOUR TRANSFER IS BEING PROCESSED'), findsOneWidget);
  });

  testWidgets('when the quote runs out a new rate is fetched automatically', (
    tester,
  ) async {
    final backend = FakeSendMoneyBackend();
    await _open(tester, backend);
    await _type(tester, 'amount_send', '100.00');
    expect(find.text('Rate guaranteed for 30:00'), findsOneWidget);
    expect(backend.count('POST', '/api/v1/quotes'), 1);

    backend.now = backend.now.add(const Duration(minutes: 29, seconds: 15));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Rate guaranteed for 0:45'), findsOneWidget);

    backend.now = backend.now.add(const Duration(seconds: 50));
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(backend.count('POST', '/api/v1/quotes'), 2);
    expect(find.text('Rate guaranteed for 30:00'), findsOneWidget);
    expect(_text(tester, 'amount_receive'), '115.94');
  });

  testWidgets(
    'currencies are picked from a searchable list of what the provider offers',
    (tester) async {
      final backend = FakeSendMoneyBackend();
      await _open(tester, backend);
      await _tapKey(tester, 'target_currency');
      expect(find.text('Euro'), findsOneWidget);
      expect(find.text('Mexican peso'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('currency_search')), 'rup');
      await tester.pumpAndSettle();
      expect(find.text('Indian rupee'), findsOneWidget);
      expect(find.text('Euro'), findsNothing);
      await tester.enterText(find.byKey(const Key('currency_search')), 'zzz');
      await tester.pumpAndSettle();
      expect(find.text('No currency matches'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('currency_search')), 'mxn');
      await tester.pumpAndSettle();
      await _tapKey(tester, 'currency_option_MXN');

      await _type(tester, 'amount_send', '10.00');
      expect(
        backend.lastBody('POST', '/api/v1/quotes')['targetCurrency'],
        'MXN',
      );
      expect(find.text('1 GBP = 23.10 MXN'), findsOneWidget);

      // The recipient form is now the provider's MXN form (CLABE).
      await _tapKey(tester, 'amount_continue');
      await _tapKey(tester, 'recipient_add');
      expect(find.text('Bank account in: MX'), findsOneWidget);
      expect(find.byKey(const Key('field_clabe')), findsOneWidget);
      expect(find.byKey(const Key('field_iban')), findsNothing);
    },
  );

  testWidgets(
    'a wrong amount, a provider refusal and a limit are all explained',
    (tester) async {
      final backend = FakeSendMoneyBackend()..perTransferLimit = 5000;
      backend.addSavedRecipient();
      await _open(tester, backend);

      await _type(tester, 'amount_send', '10.999');
      expect(
        find.text('Enter an amount with up to 2 decimal places'),
        findsOneWidget,
      );
      expect(backend.count('POST', '/api/v1/quotes'), 0);

      await _type(tester, 'amount_send', '0.50');
      expect(find.text('Send at least 1.00 GBP'), findsOneWidget);

      await _type(tester, 'amount_send', '100.00');
      await _tapKey(tester, 'amount_continue');
      await _tap(tester, find.text('Anna Schmidt'));
      await _tapKey(tester, 'field_purpose');
      await _tap(tester, find.text('Gift').last);
      await _tapKey(tester, 'questions_continue');

      await _type(tester, 'review_reference', '<script>');
      await _tapKey(tester, 'review_confirm');
      expect(find.textContaining('Use up to 35 letters'), findsOneWidget);
      expect(backend.count('POST', '/api/v1/transfers'), 0);

      await _type(tester, 'review_reference', '');
      await _tapKey(tester, 'review_confirm');
      expect(
        find.text('You can send up to 50.00 GBP in one transfer.'),
        findsOneWidget,
      );
      expect(find.text('Check your transfer'), findsOneWidget);
      expect(backend.providerTransfers, 0);
    },
  );

  testWidgets(
    'a price change for the recipient is shown on the review screen',
    (tester) async {
      final backend = FakeSendMoneyBackend();
      backend.addSavedRecipient(name: 'Schmidt GmbH', business: true);
      await _open(tester, backend);
      await _type(tester, 'amount_send', '100.00');
      await _tapKey(tester, 'amount_continue');
      await _tap(tester, find.text('Schmidt GmbH'));
      await _tapKey(tester, 'field_purpose');
      await _tap(tester, find.text('Gift').last);
      await _tapKey(tester, 'questions_continue');

      expect(
        find.textContaining('The price changed for this recipient'),
        findsOneWidget,
      );
      expect(find.text('1.40 GBP'), findsOneWidget);
      expect(find.text('0.90 GBP'), findsNothing);
    },
  );

  testWidgets('a saved recipient can be removed after confirming', (
    tester,
  ) async {
    final backend = FakeSendMoneyBackend();
    final saved = backend.addSavedRecipient();
    await _open(tester, backend);
    await _type(tester, 'amount_send', '100.00');
    await _tapKey(tester, 'amount_continue');

    await _tap(tester, find.byTooltip('Remove Anna Schmidt'));
    expect(find.text('Remove Anna Schmidt?'), findsOneWidget);
    await _tapKey(tester, 'recipient_remove_confirm');
    expect(find.byKey(Key('recipient_${saved['id']}')), findsNothing);
    expect(find.textContaining('no saved recipients'), findsOneWidget);
    expect(saved['isActive'], isFalse);
  });

  testWidgets('paying from balance, and the provider asking for approval', (
    tester,
  ) async {
    final backend = FakeSendMoneyBackend()..scaAbove = 5000;
    backend.addSavedRecipient();
    await _open(tester, backend);
    await _type(tester, 'amount_send', '100.00');
    await _tapKey(tester, 'amount_continue');
    await _tap(tester, find.text('Anna Schmidt'));
    await _tapKey(tester, 'field_purpose');
    await _tap(tester, find.text('Gift').last);
    await _tapKey(tester, 'questions_continue');
    await _tapKey(tester, 'review_confirm');

    await _tapKey(tester, 'pay_balance');
    expect(
      find.textContaining('needs you to approve this payment'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('pay_total')), findsOneWidget);

    backend.scaAbove = 500000;
    await _tapKey(tester, 'pay_balance');
    expect(find.text('YOUR TRANSFER IS BEING PROCESSED'), findsOneWidget);
    // Once the provider has the money it cannot be cancelled.
    expect(find.byKey(const Key('status_cancel')), findsNothing);
  });

  testWidgets(
    'history lists transfers newest first, pages, and opens the detail',
    (tester) async {
      _phone(tester);
      final backend = FakeSendMoneyBackend();
      backend.addSavedRecipient();
      final seed = _controller(backend);
      await tester.runAsync(() async {
        await seed.loadCurrencies();
        for (var i = 1; i <= 22; i++) {
          seed.reset();
          seed.setAmount(AmountSide.send, '$i.00');
          await seed.updateQuote();
          await seed.continueToRecipient();
          await seed.selectRecipient(seed.recipients.first);
          seed.submitAnswers({'purpose': 'gift'});
          await seed.confirm();
          backend.now = backend.now.add(const Duration(minutes: 1));
        }
      });
      expect(backend.transfers.length, 22);
      final requestsBefore = backend.requests.length;

      await tester.pumpWidget(
        MaterialApp(
          home: TransferHistoryPage(
            controller: _controller(backend),
            devTools: true,
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Newest (22.00) first; the first page holds 20.
      expect(find.textContaining('You paid 22.00 GBP'), findsOneWidget);
      expect(find.textContaining('You paid 2.00 GBP'), findsNothing);
      await tester.scrollUntilVisible(
        find.byKey(const Key('history_more')),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      await _tapKey(tester, 'history_more');
      await tester.scrollUntilVisible(
        find.textContaining('You paid 1.00 GBP'),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.byKey(const Key('history_more')), findsNothing);

      // Only our own backend's history endpoint was used.
      expect(
        backend.requests.skip(requestsBefore).map((r) => r.url.path).toSet(),
        {'/api/v1/transfers'},
      );

      await tester.scrollUntilVisible(
        find.textContaining('You paid 22.00 GBP'),
        -400,
        scrollable: find.byType(Scrollable).first,
      );
      await _tap(tester, find.textContaining('You paid 22.00 GBP'));
      expect(find.text('Waiting for your money'), findsOneWidget);
      expect(find.text('WAITING FOR YOUR MONEY'), findsOneWidget);
      expect(find.text('Anna Schmidt'), findsWidgets);
      expect(find.text('IBAN ••••3000'), findsOneWidget);
      expect(find.byKey(const Key('status_how_to_pay')), findsOneWidget);

      // From the detail the customer can still see how to pay, or cancel.
      await _tapKey(tester, 'status_how_to_pay');
      expect(find.text('MOCK1A2B3C4D'), findsOneWidget);
      await _tapKey(tester, 'pay_cancel');
      expect(find.text('THIS TRANSFER WAS CANCELLED'), findsOneWidget);
      expect(find.text('Cancelled'), findsOneWidget);
    },
  );

  testWidgets('the screens meet tap-target, label and contrast guidelines', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final backend = FakeSendMoneyBackend();
    backend.addSavedRecipient();
    await _open(tester, backend);
    Future<void> check() async {
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
    }

    await _type(tester, 'amount_send', '100.00');
    await check();
    await _tapKey(tester, 'amount_continue');
    await check();
    await _tap(tester, find.text('Anna Schmidt'));
    await _tapKey(tester, 'field_purpose');
    await _tap(tester, find.text('Gift').last);
    await check();
    await _tapKey(tester, 'questions_continue');
    await check();
    await _tapKey(tester, 'review_confirm');
    // The pay screen is longer than the phone: bring the button fully into view.
    await tester.ensureVisible(find.byKey(const Key('pay_bank_done')));
    await tester.pumpAndSettle();
    await check();
    await _tapKey(tester, 'pay_bank_done');
    await check();
    handle.dispose();
  });

  testWidgets(
    'a payout that fails after the money was taken says what happens next',
    (tester) async {
      final backend = FakeSendMoneyBackend();
      backend.addSavedRecipient();
      await _open(tester, backend);
      await _type(tester, 'amount_send', '100.00');
      await _tapKey(tester, 'amount_continue');
      await _tap(tester, find.text('Anna Schmidt'));
      await _tapKey(tester, 'field_purpose');
      await _tap(tester, find.text('Gift').last);
      await _tapKey(tester, 'questions_continue');
      await _tapKey(tester, 'review_confirm');
      await _tapKey(tester, 'pay_balance');
      final id = backend.transfers.single['id'] as String;

      // The provider paid out, then the payout bounced back.
      backend.setStatus(id, 'SENT');
      backend.setStatus(id, 'FAILED');
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      expect(find.text('THIS TRANSFER DID NOT GO THROUGH'), findsOneWidget);
      expect(find.textContaining('Your money is not lost'), findsOneWidget);
      expect(
        find.textContaining(
          'will return your 100.00 GBP to you. You do not need to do anything',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('we will email you'), findsOneWidget);
      expect(find.text('Failed'), findsOneWidget); // on the timeline
      // Nothing left to pay, cancel or retry.
      expect(find.byKey(const Key('status_cancel')), findsNothing);
      expect(find.byKey(const Key('status_how_to_pay')), findsNothing);
    },
  );

  testWidgets('a failure before any money was taken says nothing was taken', (
    tester,
  ) async {
    final backend = FakeSendMoneyBackend();
    backend.addSavedRecipient();
    await _open(tester, backend);
    await _type(tester, 'amount_send', '100.00');
    await _tapKey(tester, 'amount_continue');
    await _tap(tester, find.text('Anna Schmidt'));
    await _tapKey(tester, 'field_purpose');
    await _tap(tester, find.text('Gift').last);
    await _tapKey(tester, 'questions_continue');
    await _tapKey(tester, 'review_confirm');
    await _tapKey(tester, 'pay_bank_done');
    backend.setStatus(backend.transfers.single['id'] as String, 'FAILED');
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('nothing has been taken from you'),
      findsOneWidget,
    );
    expect(find.textContaining('Your money is not lost'), findsNothing);
  });

  testWidgets('the mock test tool is never offered without dev tools', (
    tester,
  ) async {
    final backend = FakeSendMoneyBackend();
    backend.addSavedRecipient();
    await _open(tester, backend, devTools: false);
    await _type(tester, 'amount_send', '100.00');
    await _tapKey(tester, 'amount_continue');
    await _tap(tester, find.text('Anna Schmidt'));
    await _tapKey(tester, 'field_purpose');
    await _tap(tester, find.text('Gift').last);
    await _tapKey(tester, 'questions_continue');
    await _tapKey(tester, 'review_confirm');
    await _tapKey(tester, 'pay_bank_done');
    expect(find.byKey(const Key('status_refresh')), findsOneWidget);
    expect(find.byKey(const Key('dev_simulate')), findsNothing);
  });
}
