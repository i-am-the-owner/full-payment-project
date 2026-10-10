import 'package:almapay/features/legal/presentation/legal_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('delete request names the account and the support address', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: DeleteDataPage(
          supportEmail: 'help@example.test',
          accountEmail: 'me@example.test',
        ),
      ),
    );
    final text = tester.widget<Text>(
      find.byKey(const Key('delete_request_text')),
    );
    expect(text.data, contains('help@example.test'));
    expect(text.data, contains('me@example.test'));
  });

  testWidgets('about page says AaminPay never holds money', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: AboutPage(appName: 'X')));
    expect(find.textContaining('never hold your money'), findsOneWidget);
  });
}
