import 'package:almapay/features/identity/presentation/identity_check_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a passport has one photo; a licence also needs the back', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: IdentityCheckPage(verified: false)),
    );
    // A tall screen, so the whole page is built at once.
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pump();
    expect(find.byKey(const Key('upload_front')), findsOneWidget);
    expect(find.byKey(const Key('upload_back')), findsNothing);

    await tester.tap(find.byKey(const Key('document_drivingLicence')));
    await tester.pump();
    expect(find.byKey(const Key('upload_back')), findsOneWidget);
  });

  testWidgets('nothing can be sent yet: Continue is switched off', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: IdentityCheckPage(verified: false)),
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('identity_continue')),
      200,
    );
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('identity_continue')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('says when the customer is already verified', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: IdentityCheckPage(verified: true)),
    );
    expect(find.text('Identity verified'), findsOneWidget);
  });
}
