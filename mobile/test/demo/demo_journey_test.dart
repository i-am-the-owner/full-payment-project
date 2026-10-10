import 'package:almapay/demo/demo_app.dart';
import 'package:almapay/demo/demo_models.dart';
import 'package:almapay/demo/demo_money.dart';
import 'package:almapay/demo/demo_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The whole demo, on a 390px-wide phone, with the sample data from the design
/// reference. No network is involved anywhere: the demo has no HTTP client.

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<DemoStore> _open(WidgetTester tester) async {
  _phone(tester);
  final store = DemoStore();
  addTearDown(store.dispose);
  await tester.pumpWidget(DemoApp(store: store));
  await tester.pump();
  return store;
}

void _expectBanner() {
  expect(find.byKey(const Key('demo_banner')), findsOneWidget);
  expect(find.text(demoLabel), findsOneWidget);
}

Future<void> _tap(WidgetTester tester, String key) async {
  final f = find.byKey(Key(key));
  if (f.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      f,
      200,
      scrollable: find.byType(Scrollable).last,
    );
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> _signUp(WidgetTester tester) async {
  await _tap(tester, 'create_account');
  _expectBanner();
  await _tap(tester, 'continue_sign_up');
  _expectBanner();
  await tester.enterText(find.byKey(const Key('code_field')), '1');
  await tester.pump();
  await _tap(tester, 'confirm_code');
}

void main() {
  test('the sample figures match the design reference', () {
    expect(foreign(india, receiveFor(india, 50000)), '₹55,880.62');
    expect(gbp(feeFor(50000)), '£3.12');
    expect(foreign(mexico, receiveFor(mexico, 20000)), 'MX\$4,612.00');
    expect(gbp(feeFor(20000)), '£2.40');
    expect(india.rateText, '112.4630');
    expect(mexico.rateText, '23.3401');
    expect(parsePence('12.5'), 1250);
    expect(parsePence('0.'), 0);
    expect(parsePence('1.234'), isNull);
  });

  testWidgets(
    'welcome, sign-up with any code, then home with the sample people',
    (tester) async {
      await _open(tester);
      _expectBanner();
      expect(find.text('From here,\nto home.'), findsOneWidget);
      await _signUp(tester);
      _expectBanner();
      expect(find.text('Hi Sara'), findsOneWidget);
      expect(
        find.text('Priya, Bengaluru'.replaceFirst('Priya', 'Priya')),
        findsOneWidget,
      );
      expect(find.text('₹112.4630'), findsOneWidget);
      expect(find.byKey(const Key('home_open_transfer')), findsOneWidget);
      expect(find.text('Waiting for your £500.00'), findsOneWidget);
      expect(find.text('Juan Pérez'), findsOneWidget);
      expect(find.text('Ama Mensah'), findsOneWidget);
      expect(find.text('Rahul Kapoor'), findsOneWidget);
    },
  );

  testWidgets(
    'send: amount, add a recipient, confirm, pay, tracking moves by itself, receipt',
    (tester) async {
      final store = await _open(tester);
      await _signUp(tester);

      // Add a new person from the home screen, then send to them.
      await _tap(tester, 'home_add_someone');
      _expectBanner();
      await _tap(tester, 'person_save'); // empty: refused
      expect(find.byKey(const Key('person_error')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('person_name')),
        'Luis Gómez',
      );
      await tester.enterText(find.byKey(const Key('person_city')), 'Monterrey');
      await tester.enterText(find.byKey(const Key('person_bank')), 'Banorte');
      await tester.enterText(
        find.byKey(const Key('person_account')),
        '123456789012',
      );
      await _tap(tester, 'dest_MX');
      await _tap(tester, 'person_save_send');
      _expectBanner();
      expect(
        store.people.first.accountTail,
        '9012',
        reason: 'only the last four digits are kept',
      );

      // Amount: the keypad types, the ticket fills in.
      expect(find.text('Send to Luis'), findsOneWidget);
      for (final k in ['<', '<', '<', '2', '0', '0']) {
        await _tap(tester, 'key_$k');
      }
      expect(find.text('£200'), findsOneWidget);
      expect(find.text('MX\$4,612.00'), findsOneWidget);
      await _tap(tester, 'key_<');
      await _tap(tester, 'key_<');
      await _tap(tester, 'key_<');
      await _tap(tester, 'key_5');
      await _tap(tester, 'key_0');
      await _tap(tester, 'key_0');
      await _tap(tester, 'key_0');
      await _tap(tester, 'key_0');
      await _tap(tester, 'key_0');
      expect(find.byKey(const Key('amount_continue')), findsOneWidget);
      // 500000 is more than the limit: refused with a clear message.
      expect(find.byKey(const Key('amount_problem')), findsOneWidget);
      for (var i = 0; i < 5; i++) {
        await _tap(tester, 'key_<');
      }
      for (final k in ['3', '0', '0']) {
        await _tap(tester, 'key_$k');
      }
      expect(find.byKey(const Key('amount_problem')), findsNothing);
      await _tap(tester, 'amount_continue');
      _expectBanner();

      // Review the ticket, then confirm.
      expect(find.text('Check your ticket'), findsOneWidget);
      expect(find.byKey(const Key('rate_countdown')), findsOneWidget);
      await _tap(tester, 'confirm_transfer');
      _expectBanner();
      expect(find.text('Pay for your ticket'), findsOneWidget);
      final reference = tester
          .widget<Text>(find.byKey(const Key('pay_reference')))
          .data!;
      expect(reference, startsWith('P'));
      expect(store.transfers.first.status, DemoStatus.awaitingPayment);

      // "I've paid": it travels through every status, one step every few seconds.
      await _tap(tester, 'i_have_paid');
      _expectBanner();
      expect(find.text('Status: On its way'), findsOneWidget);
      expect(store.transfers.first.status, DemoStatus.paymentReceived);
      await tester.pump(const Duration(seconds: 4));
      expect(store.transfers.first.status, DemoStatus.converting);
      await tester.pump(const Duration(seconds: 4));
      expect(store.transfers.first.status, DemoStatus.delivered);
      await tester.pump();
      expect(find.text('Luis has it'), findsOneWidget);

      await _tap(tester, 'view_receipt');
      _expectBanner();
      expect(find.text('Receipt'), findsOneWidget);
      expect(find.textContaining('DELIVERED'), findsOneWidget);
      expect(find.text(reference), findsOneWidget);
      await _tap(tester, 'send_again');
      expect(find.text('Send to Luis'), findsOneWidget);
    },
  );

  testWidgets(
    'pay the sample ticket from home, then a rejected payment comes back',
    (tester) async {
      final store = await _open(tester);
      await _signUp(tester);
      await _tap(tester, 'home_pay_now');
      expect(find.text('P38291745'), findsOneWidget);
      expect(find.text('Send £500.00 from your bank'), findsOneWidget);
      await _tap(tester, 'i_have_paid');
      await tester.pump(const Duration(seconds: 4));
      expect(store.transfers.first.status, DemoStatus.converting);

      await _tap(tester, 'demo_reject');
      expect(store.transfers.first.status, DemoStatus.returning);
      await tester.pump(const Duration(seconds: 4));
      expect(store.transfers.first.status, DemoStatus.returned);
      await tester.pump();
      await _tap(tester, 'view_returned');
      _expectBanner();
      expect(find.byKey(const Key('returned_amount')), findsOneWidget);
      expect(find.text('£500.00'), findsOneWidget);
      expect(find.text('Within 3 working days'), findsOneWidget);
      expect(find.text('Fix details and send again'), findsOneWidget);
    },
  );

  testWidgets(
    'transfers list, the returned sample, people search and the account screen',
    (tester) async {
      final store = await _open(tester);
      await _signUp(tester);

      await tester.tap(find.text('Transfers').last);
      await tester.pumpAndSettle();
      _expectBanner();
      expect(find.text('Waiting for you'), findsOneWidget);
      expect(find.text('Delivered'), findsOneWidget);
      expect(find.text('Returned'), findsOneWidget);
      expect(find.text('MX\$4,612.00'), findsOneWidget);
      expect(find.text('GH₵2,710.50'), findsOneWidget);
      await _tap(tester, 'transfer_P36118840');
      _expectBanner();
      expect(find.text('£150.00'), findsOneWidget);
      expect(
        find.textContaining("Ama's bank rejected the payment"),
        findsOneWidget,
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      await _tap(tester, 'transfer_P37902218');
      expect(find.text('Receipt'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();

      await tester.tap(find.text('People').last);
      await tester.pumpAndSettle();
      _expectBanner();
      await tester.enterText(find.byKey(const Key('people_search')), 'guada');
      await tester.pump();
      expect(find.byKey(const Key('people_juan')), findsOneWidget);
      expect(find.byKey(const Key('people_priya')), findsNothing);

      await tester.tap(find.text('You').last);
      await tester.pumpAndSettle();
      _expectBanner();
      expect(find.byKey(const Key('account_name')), findsOneWidget);
      expect(find.textContaining('does not hold your money'), findsOneWidget);
      await _tap(tester, 'sign_out');
      expect(store.signedIn, isFalse);
      expect(find.text('From here,\nto home.'), findsOneWidget);
      _expectBanner();
    },
  );

  testWidgets(
    'log in works with any details, and reset restores the sample data',
    (tester) async {
      final store = await _open(tester);
      await _tap(tester, 'log_in');
      await _tap(tester, 'continue_sign_up');
      expect(store.signedIn, isTrue);
      store.createTransfer(priya, 10000);
      expect(store.transfers.length, 4);
      store.reset();
      await tester.pumpAndSettle();
      expect(store.transfers.length, 3);
      expect(store.signedIn, isFalse);
    },
  );
}
