import 'package:almapay/features/send_money/domain/models.dart';
import 'package:almapay/features/send_money/presentation/widgets/dynamic_form_fields.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_send_money_backend.dart';

/// Hosts the renderer the way the recipient screen does: it re-requests the
/// form when asked and hands the new one back.
class _Host extends StatefulWidget {
  const _Host({required this.currency, this.form});

  final String currency;
  final DynamicForm? form;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  final formKey = GlobalKey<FormState>();
  late DynamicForm form =
      widget.form ?? DynamicForm.fromJson(mockRecipientForm(widget.currency));
  Map<String, String> values = {};
  final refreshes = <Map<String, String>>[];
  Map<String, String> serverErrors = {};

  void setServerErrors(Map<String, String> errors) =>
      setState(() => serverErrors = errors);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Form(
            key: formKey,
            child: DynamicFormFields(
              form: form,
              serverErrors: serverErrors,
              onChanged: (v) => values = v,
              onRefresh: (v) {
                refreshes.add(v);
                // What the backend would answer for these partial values.
                setState(
                  () => form = DynamicForm.fromJson(
                    mockRecipientForm(
                      widget.currency,
                      business: v['legalType'] == 'BUSINESS',
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

Future<_HostState> _pump(
  WidgetTester tester,
  String currency, {
  DynamicForm? form,
  Size size = const Size(375, 812), // a 375px-wide phone
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(_Host(currency: currency, form: form));
  return tester.state<_HostState>(find.byType(_Host));
}

Finder _field(String key) => find.byKey(Key('field_$key'));

Future<void> _type(WidgetTester tester, String key, String text) async {
  await tester.ensureVisible(_field(key));
  await tester.enterText(_field(key), text);
  await tester.pump();
}

Future<void> _choose(WidgetTester tester, String key, String label) async {
  await tester.ensureVisible(_field(key));
  await tester.tap(_field(key));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

void main() {
  group('EUR (IBAN)', () {
    testWidgets('draws the provider’s groups and fields, nothing of its own', (
      tester,
    ) async {
      await _pump(tester, 'EUR');
      expect(find.text('Account holder'), findsOneWidget);
      expect(find.text('Bank account'), findsOneWidget);
      expect(find.text('Recipient type'), findsOneWidget);
      expect(find.text('Person'), findsOneWidget);
      expect(find.text('Business'), findsOneWidget);
      expect(_field('accountHolderName'), findsOneWidget);
      expect(_field('iban'), findsOneWidget);
      // Optional fields say so; the example comes from the provider.
      expect(find.text('BIC / SWIFT (optional)'), findsOneWidget);
      expect(find.text('For example DE89370400440532013000'), findsOneWidget);
      // No field for another currency leaks in.
      expect(_field('routingNumber'), findsNothing);
      expect(_field('ifsc'), findsNothing);
      expect(_field('clabe'), findsNothing);
    });

    testWidgets('shows the provider’s rules inline as the customer types', (
      tester,
    ) async {
      final host = await _pump(tester, 'EUR');

      await _type(tester, 'iban', 'not-an-iban');
      expect(
        find.text(
          'This does not look right. It should look like DE89370400440532013000',
        ),
        findsOneWidget,
      );
      await _type(tester, 'iban', 'DE89370400440532013000');
      expect(find.textContaining('does not look right'), findsNothing);

      await _type(tester, 'accountHolderName', 'A');
      expect(find.text('Must be at least 2 characters'), findsOneWidget);
      await _type(tester, 'accountHolderName', 'A' * 141);
      expect(find.text('Must be 140 characters or fewer'), findsOneWidget);
      await _type(tester, 'accountHolderName', 'Anna Schmidt');

      // Submitting with a required choice missing names what is missing.
      expect(host.formKey.currentState!.validate(), isFalse);
      await tester.pump();
      expect(find.text('Enter the recipient type'), findsOneWidget);

      await tester.tap(find.byKey(const Key('field_legalType_PRIVATE')));
      await tester.pump();
      expect(host.formKey.currentState!.validate(), isTrue);
      expect(host.values, {
        'legalType': 'PRIVATE',
        'accountHolderName': 'Anna Schmidt',
        'iban': 'DE89370400440532013000',
      });
    });

    testWidgets(
      'a refreshOnChange field re-requests the form and keeps what was typed',
      (tester) async {
        final host = await _pump(tester, 'EUR');
        await _type(tester, 'accountHolderName', 'Schmidt GmbH');
        await _type(tester, 'iban', 'DE89370400440532013000');
        expect(host.refreshes, isEmpty);

        // Choosing "Business" changes the form: a new field appears.
        await tester.tap(find.byKey(const Key('field_legalType_BUSINESS')));
        await tester.pumpAndSettle();
        expect(host.refreshes.single, {
          'accountHolderName': 'Schmidt GmbH',
          'iban': 'DE89370400440532013000',
          'legalType': 'BUSINESS',
        });
        expect(_field('businessName'), findsOneWidget);

        // Nothing typed was lost.
        expect(find.text('Schmidt GmbH'), findsOneWidget);
        expect(find.text('DE89370400440532013000'), findsOneWidget);

        await _type(tester, 'businessName', 'Schmidt Trading');
        expect(host.values['businessName'], 'Schmidt Trading');

        // Back to "Person": the extra field goes, and so does its value.
        await tester.tap(find.byKey(const Key('field_legalType_PRIVATE')));
        await tester.pumpAndSettle();
        expect(_field('businessName'), findsNothing);
        expect(find.text('Schmidt GmbH'), findsOneWidget);
        expect(find.text('DE89370400440532013000'), findsOneWidget);
        await _type(tester, 'iban', 'DE89370400440532013001');
        expect(host.values, {
          'accountHolderName': 'Schmidt GmbH',
          'iban': 'DE89370400440532013001',
          'legalType': 'PRIVATE',
        });
      },
    );

    testWidgets('typing in an ordinary field does not re-request the form', (
      tester,
    ) async {
      final host = await _pump(tester, 'EUR');
      await _type(tester, 'iban', 'DE89370400440532013000');
      await _type(tester, 'accountHolderName', 'Anna');
      expect(host.refreshes, isEmpty);
    });

    testWidgets(
      'problems the provider reports after submitting sit on the field',
      (tester) async {
        final host = await _pump(tester, 'EUR');
        host.setServerErrors({'iban': 'IBAN is not valid'});
        await tester.pump();
        expect(find.text('IBAN is not valid'), findsOneWidget);
      },
    );
  });

  group('USD (account + routing)', () {
    testWidgets('account, routing number and an account-type select', (
      tester,
    ) async {
      final host = await _pump(tester, 'USD');
      expect(_field('routingNumber'), findsOneWidget);
      expect(_field('accountNumber'), findsOneWidget);
      expect(_field('accountType'), findsOneWidget);
      expect(_field('iban'), findsNothing);

      await _type(tester, 'routingNumber', '12345');
      expect(find.textContaining('does not look right'), findsOneWidget);
      await _type(tester, 'routingNumber', '021000021');
      expect(find.textContaining('does not look right'), findsNothing);

      await _type(tester, 'accountNumber', '12');
      expect(find.textContaining('does not look right'), findsOneWidget);
      await _type(tester, 'accountNumber', '123456789');

      await _choose(tester, 'accountType', 'Savings');
      await _type(tester, 'accountHolderName', 'John Doe');
      await tester.ensureVisible(
        find.byKey(const Key('field_legalType_PRIVATE')),
      );
      await tester.tap(find.byKey(const Key('field_legalType_PRIVATE')));
      await tester.pump();

      expect(host.formKey.currentState!.validate(), isTrue);
      expect(host.values, {
        'routingNumber': '021000021',
        'accountNumber': '123456789',
        'accountType': 'SAVINGS',
        'accountHolderName': 'John Doe',
        'legalType': 'PRIVATE',
      });
    });
  });

  group('on a desktop-width window', () {
    const desktop = Size(1280, 800);
    const required = {
      'EUR': ['iban', 'accountHolderName'],
      'USD': ['routingNumber', 'accountNumber', 'accountType'],
      'INR': ['ifsc', 'accountNumber'],
      'MXN': ['clabe'],
    };
    for (final entry in required.entries) {
      testWidgets(
        'the ${entry.key} recipient form is drawn from the provider',
        (tester) async {
          await _pump(tester, entry.key, size: desktop);
          for (final key in entry.value) {
            expect(_field(key), findsOneWidget, reason: '${entry.key} $key');
          }
        },
      );
    }
  });

  group('INR (IFSC)', () {
    testWidgets('IFSC code and account number, with the provider’s pattern', (
      tester,
    ) async {
      final host = await _pump(tester, 'INR');
      expect(_field('ifsc'), findsOneWidget);
      expect(find.text('For example HDFC0001234'), findsOneWidget);

      await _type(tester, 'ifsc', 'HDFC1001234'); // fifth character must be 0
      expect(
        find.text('This does not look right. It should look like HDFC0001234'),
        findsOneWidget,
      );
      await _type(tester, 'ifsc', 'HDFC0001234');
      expect(find.textContaining('does not look right'), findsNothing);

      await _type(tester, 'accountNumber', '12345678');
      expect(find.textContaining('does not look right'), findsOneWidget);
      await _type(tester, 'accountNumber', '123456789012');
      expect(find.textContaining('does not look right'), findsNothing);
      expect(host.values['ifsc'], 'HDFC0001234');
    });
  });

  group('MXN (CLABE)', () {
    testWidgets('an 18-digit CLABE', (tester) async {
      final host = await _pump(tester, 'MXN');
      expect(_field('clabe'), findsOneWidget);
      expect(_field('accountNumber'), findsNothing);

      await _type(tester, 'clabe', '03218000011835971');
      expect(find.textContaining('does not look right'), findsOneWidget);
      await _type(tester, 'clabe', '032180000118359719');
      expect(find.textContaining('does not look right'), findsNothing);
      expect(host.values, {'clabe': '032180000118359719'});
    });
  });

  group('transfer questions and other field types', () {
    testWidgets('the INR transfer form asks for purpose and source of funds', (
      tester,
    ) async {
      final host = await _pump(
        tester,
        'INR',
        form: DynamicForm.fromJson(mockTransferForm('INR')),
      );
      expect(find.text('About this transfer'), findsOneWidget);
      await _choose(tester, 'purpose', 'Family support');
      await _choose(tester, 'sourceOfFunds', 'Salary');
      expect(host.formKey.currentState!.validate(), isTrue);
      expect(host.values, {
        'purpose': 'family_support',
        'sourceOfFunds': 'salary',
      });
    });

    testWidgets('a date field takes a typed date and checks it', (
      tester,
    ) async {
      final host = await _pump(
        tester,
        'EUR',
        form: DynamicForm.fromJson({
          'groups': [
            {'key': 'g', 'label': 'About the recipient'},
          ],
          'fields': [
            {
              'key': 'dateOfBirth',
              'label': 'Date of birth',
              'type': 'date',
              'required': true,
              'group': 'g',
              'validation': <String, dynamic>{},
              'refreshOnChange': false,
            },
            {
              'key': 'note',
              'label': 'Note',
              'type': 'text',
              'required': false,
              // A group the provider did not describe is still shown.
              'group': 'somewhere-else',
              'validation': {'maxLength': 5},
              'refreshOnChange': false,
            },
          ],
        }),
      );
      expect(find.text('Note (optional)'), findsOneWidget);
      expect(
        find.byTooltip('Choose Date of birth from a calendar'),
        findsOneWidget,
      );

      await _type(tester, 'dateOfBirth', 'yesterday');
      expect(find.text('Enter a date'), findsOneWidget);
      await _type(tester, 'dateOfBirth', '1990-04-27');
      expect(find.text('Enter a date'), findsNothing);
      expect(host.formKey.currentState!.validate(), isTrue);
      expect(host.values, {'dateOfBirth': '1990-04-27'});

      // The calendar writes the same format.
      await tester.tap(find.byTooltip('Choose Date of birth from a calendar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(host.values, {'dateOfBirth': '1990-04-27'});
    });

    test('a pattern the app cannot read is left for the provider to check', () {
      final field = DynamicFormField.fromJson({
        'key': 'x',
        'label': 'Code',
        'type': 'text',
        'required': true,
        'group': '',
        'validation': {'pattern': '(?<broken'},
        'refreshOnChange': false,
      });
      expect(field.validate('anything'), isNull);
      expect(field.validate(''), 'Enter the code');
    });
  });
}
