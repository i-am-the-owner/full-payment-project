import 'dart:convert';

import 'package:almapay/app/environment/app_config.dart';
import 'package:almapay/app/environment/app_environment.dart';
import 'package:almapay/core/network/api_exception.dart';
import 'package:almapay/features/auth/domain/auth_repository.dart';
import 'package:almapay/features/auth/domain/auth_user.dart';
import 'package:almapay/features/auth/presentation/auth_controller.dart';
import 'package:almapay/features/auth/presentation/auth_gate.dart';
import 'package:almapay/features/onboarding/data/onboarding_api.dart';
import 'package:almapay/features/onboarding/presentation/onboarding_controller.dart';
import 'package:almapay/features/send_money/data/send_money_api.dart';
import 'package:almapay/features/send_money/data/send_money_repository_impl.dart';
import 'package:almapay/features/send_money/presentation/send_money_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _StubRepository implements AuthRepository {
  _StubRepository(this._user);
  final AuthUser? _user;
  AuthUser? loginResult;
  bool totpRequired = false;
  String? lastTotpCode;

  @override
  Future<AuthUser?> currentUser() async => _user;
  @override
  Future<AuthUser> login({
    required String email,
    required String password,
    String? totpCode,
  }) async {
    lastTotpCode = totpCode;
    if (totpRequired && totpCode == null) {
      throw ApiException(
        statusCode: 401,
        code: 'TOTP_REQUIRED',
        message: 'Enter the 6-digit code from your authenticator app.',
      );
    }
    return loginResult!;
  }

  @override
  Future<void> register({
    required String email,
    required String password,
  }) async {}
  @override
  Future<void> requestPasswordReset(String email) async {}
  @override
  Future<void> logout() async {}
  @override
  Future<void> verifyEmail(String token) async {}
  @override
  Future<void> resendVerificationEmail() async {}
}

final _config = AppConfig.forEnvironment(AppEnvironment.development);

const _user = AuthUser(
  id: 'u1',
  email: 'user@example.test',
  emailVerified: true,
  roles: ['customer'],
);

/// A backend that reports a verified customer.
final _client = MockClient((request) async {
  if (request.url.path == '/api/v1/onboarding/status') {
    return http.Response(
      jsonEncode({
        'data': {
          'status': 'VERIFIED',
          'emailVerified': true,
          'profileComplete': true,
        },
      }),
      200,
    );
  }
  return http.Response('not found', 404);
});

Widget _wrap(AuthController controller) => MaterialApp(
  home: AuthGate(
    controller: controller,
    config: _config,
    onboarding: OnboardingController(
      OnboardingApi(baseUrl: _config.apiBaseUrl, client: _client),
    ),
    sendMoney: SendMoneyController(
      SendMoneyRepositoryImpl(
        api: SendMoneyApi(baseUrl: _config.apiBaseUrl, client: _client),
      ),
    ),
  ),
);

void main() {
  testWidgets('shows the login screen when unauthenticated', (tester) async {
    final controller = AuthController(_StubRepository(null));
    await controller.restoreSession();

    await tester.pumpWidget(_wrap(controller));
    await tester.pumpAndSettle();

    expect(find.text('Log in'), findsWidgets);
    expect(find.byKey(const Key('login_submit')), findsOneWidget);
  });

  testWidgets('shows the home screen when authenticated', (tester) async {
    final controller = AuthController(_StubRepository(_user));
    await controller.restoreSession();

    await tester.pumpWidget(_wrap(controller));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('stage_verified')), findsOneWidget);
    expect(find.byKey(const Key('welcome_heading')), findsOneWidget);
    expect(find.text('Signed in as user@example.test'), findsNothing);
    await tester.tap(find.text('You'));
    await tester.pumpAndSettle();
    // The list is long enough that Sign out sits below the fold.
    await tester.scrollUntilVisible(find.byKey(const Key('sign_out')), 200);
    expect(find.byKey(const Key('sign_out')), findsOneWidget);
  });

  testWidgets('creating an account signs the customer straight in', (
    tester,
  ) async {
    final repository = _StubRepository(null)..loginResult = _user;
    final controller = AuthController(repository);
    await controller.restoreSession();
    await tester.pumpWidget(_wrap(controller));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('login_sign_up')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('register_email')),
      'new@example.test',
    );
    await tester.enterText(
      find.byKey(const Key('register_password')),
      'a strong enough passphrase',
    );
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pumpAndSettle();

    // No trip back to the log in screen: the signed-in app is showing.
    expect(find.byKey(const Key('login_submit')), findsNothing);
    expect(find.byKey(const Key('register_submit')), findsNothing);
    expect(find.byKey(const Key('stage_verified')), findsOneWidget);
  });

  testWidgets('login form validates empty fields', (tester) async {
    final controller = AuthController(_StubRepository(null));
    await controller.restoreSession();
    await tester.pumpWidget(_wrap(controller));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('login_submit')));
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pump();

    expect(find.text('Enter your email'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
  });

  testWidgets(
    'two-step sign-in: the code field appears, keeps what was typed, and signs in',
    (tester) async {
      final repo = _StubRepository(null)
        ..totpRequired = true
        ..loginResult = _user;
      final controller = AuthController(repo);
      await controller.restoreSession();
      await tester.pumpWidget(_wrap(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('login_totp_code')), findsNothing);
      await tester.enterText(
        find.byKey(const Key('login_email')),
        'user@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('login_password')),
        'a strong passphrase',
      );
      await tester.ensureVisible(find.byKey(const Key('login_submit')));
      await tester.tap(find.byKey(const Key('login_submit')));
      await tester.pumpAndSettle();

      // Still on the sign-in screen, with the email kept and a code field.
      expect(find.byKey(const Key('login_totp_code')), findsOneWidget);
      expect(find.text('user@example.test'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('login_totp_code')),
        '123456',
      );
      await tester.ensureVisible(find.byKey(const Key('login_submit')));
      await tester.tap(find.byKey(const Key('login_submit')));
      await tester.pumpAndSettle();

      expect(repo.lastTotpCode, '123456');
      expect(find.byKey(const Key('stage_verified')), findsOneWidget);
    },
  );
}
