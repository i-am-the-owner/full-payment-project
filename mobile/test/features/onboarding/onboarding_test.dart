import 'dart:convert';

import 'package:almapay/app/environment/app_config.dart';
import 'package:almapay/app/environment/app_environment.dart';
import 'package:almapay/features/auth/domain/auth_repository.dart';
import 'package:almapay/features/auth/domain/auth_user.dart';
import 'package:almapay/features/auth/presentation/auth_controller.dart';
import 'package:almapay/features/home/presentation/home_page.dart';
import 'package:almapay/features/onboarding/data/onboarding_api.dart';
import 'package:almapay/features/onboarding/domain/onboarding_models.dart';
import 'package:almapay/features/onboarding/presentation/onboarding_controller.dart';
import 'package:almapay/features/onboarding/presentation/provider_web_view_page.dart';
import 'package:almapay/features/send_money/data/send_money_api.dart';
import 'package:almapay/features/send_money/data/send_money_repository_impl.dart';
import 'package:almapay/features/send_money/presentation/send_money_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final _config = AppConfig.forEnvironment(AppEnvironment.development);
final _providerPage = Uri.parse('https://provider.example/kyc/abc');

/// An in-memory stand-in for the AaminPay backend's onboarding endpoints.
class _Backend {
  String status = 'UNVERIFIED';
  bool emailVerified = true;
  Map<String, dynamic> profile = {};
  List<String> supportedCountries = ['GB'];
  bool offline = false;
  final requests = <http.Request>[];

  bool get _profileComplete => profile.length == 5;

  http.Response _json(int code, Object body) => http.Response(
    jsonEncode(body),
    code,
    headers: {'content-type': 'application/json'},
  );

  MockClient get client => MockClient((request) async {
    requests.add(request);
    if (offline) {
      throw http.ClientException('offline');
    }
    final route = '${request.method} ${request.url.path}';
    switch (route) {
      case 'GET /api/v1/onboarding/status':
        return _json(200, {
          'data': {
            'status': status,
            'emailVerified': emailVerified,
            'profileComplete': _profileComplete,
          },
        });
      case 'GET /api/v1/profile':
        return _json(200, {
          'data': {
            'profile': profile,
            'complete': _profileComplete,
            'supportedCountries': supportedCountries,
          },
        });
      case 'PUT /api/v1/profile':
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['countryOfResidence'] != 'GB') {
          return _json(422, {
            'error': {
              'code': 'COUNTRY_NOT_SUPPORTED',
              'message': "Sorry, we can't offer transfers to people living in that country yet.",
              'fieldErrors': [
                {
                  'field': 'body.countryOfResidence',
                  'message': 'Country not supported yet',
                },
              ],
            },
          });
        }
        profile = body;
        return _json(200, {
          'data': {'profile': body, 'complete': true},
        });
      case 'POST /api/v1/onboarding/start':
        if (status == 'VERIFIED' || status == 'REJECTED_PENDING_REVIEW') {
          return _json(200, {
            'data': {'kind': 'done', 'status': status},
          });
        }
        if (status == 'UNVERIFIED') status = 'PENDING';
        return _json(200, {
          'data': {'kind': 'redirect', 'url': '$_providerPage'},
        });
    }
    return _json(404, {
      'error': {'code': 'NOT_FOUND', 'message': 'Not found.'},
    });
  });

  int count(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path).length;
}

class _AuthRepository implements AuthRepository {
  _AuthRepository(this.backend);
  final _Backend backend;
  String? verifiedWith;
  int resendCalls = 0;

  @override
  Future<AuthUser?> currentUser() async => AuthUser(
    id: 'u1',
    email: 'jane@example.test',
    emailVerified: backend.emailVerified,
    roles: const ['customer'],
  );
  @override
  Future<AuthUser> login({
    required String email,
    required String password,
    String? totpCode,
  }) async => (await currentUser())!;
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
  Future<void> verifyEmail(String token) async {
    verifiedWith = token;
    backend.emailVerified = true;
  }

  @override
  Future<void> resendVerificationEmail() async {
    resendCalls++;
  }
}

OnboardingController _controller(_Backend backend) => OnboardingController(
  OnboardingApi(baseUrl: _config.apiBaseUrl, client: backend.client),
);

class _Harness {
  _Harness(this.backend) : authRepository = _AuthRepository(backend);
  final _Backend backend;
  final _AuthRepository authRepository;
  final opened = <Uri>[];

  /// What happens on the provider's page while it is open.
  void Function()? onProviderPage;

  Future<void> pump(WidgetTester tester) async {
    final auth = AuthController(authRepository);
    await auth.restoreSession();
    await tester.pumpWidget(
      MaterialApp(
        home: HomePage(
          controller: auth,
          config: _config,
          onboarding: _controller(backend),
          sendMoney: SendMoneyController(
            SendMoneyRepositoryImpl(
              api: SendMoneyApi(
                baseUrl: _config.apiBaseUrl,
                client: backend.client,
              ),
            ),
          ),
          openProviderPage: (context, url) async {
            opened.add(url);
            onProviderPage?.call();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }
}

Future<void> _fillProfile(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('profile_first_name')), 'Jane');
  await tester.enterText(find.byKey(const Key('profile_last_name')), 'Doe');
  await tester.enterText(find.byKey(const Key('profile_dob_day')), '12');
  await tester.enterText(find.byKey(const Key('profile_dob_month')), '4');
  await tester.enterText(find.byKey(const Key('profile_dob_year')), '1990');
  await tester.enterText(
    find.byKey(const Key('profile_phone')),
    '+44 7700 900123',
  );
}

Future<void> _tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  test('the next account does not inherit the previous progress', () async {
    final backend = _Backend()..status = 'VERIFIED';
    final controller = _controller(backend);
    await controller.load();
    expect(controller.stage, OnboardingStage.verified);

    controller.clear();

    expect(controller.stage, OnboardingStage.loading);
  });

  group('which screen the customer sees', () {
    Future<OnboardingStage> stageFor(
      String status, {
      bool emailVerified = true,
      bool profile = true,
    }) async {
      final backend = _Backend()
        ..status = status
        ..emailVerified = emailVerified
        ..profile = profile
            ? {
                'firstName': 'Jane',
                'lastName': 'Doe',
                'dateOfBirth': '1990-04-12',
                'countryOfResidence': 'GB',
                'phone': '+447700900123',
              }
            : {};
      final controller = _controller(backend);
      await controller.load();
      return controller.stage;
    }

    test('follows the status the backend reports', () async {
      expect(
        await stageFor('UNVERIFIED', emailVerified: false),
        OnboardingStage.verifyEmail,
      );
      expect(
        await stageFor('UNVERIFIED', profile: false),
        OnboardingStage.profile,
      );
      expect(await stageFor('UNVERIFIED'), OnboardingStage.verifyIdentity);
      expect(await stageFor('PENDING'), OnboardingStage.inProgress);
      expect(await stageFor('VERIFIED'), OnboardingStage.verified);
      expect(await stageFor('REJECTED'), OnboardingStage.couldNotVerify);
      expect(
        await stageFor('REJECTED_PENDING_REVIEW'),
        OnboardingStage.couldNotVerify,
      );
      expect(await stageFor('NEEDS_RELINK'), OnboardingStage.reconnect);
    });

    test('an unknown status is never treated as verified', () async {
      expect(await stageFor('SOMETHING_NEW'), OnboardingStage.verifyIdentity);
      expect(KycStatus.parse(null), KycStatus.unverified);
      expect(KycStatus.parse('verified'), KycStatus.unverified);
    });

    test(
      'a network failure shows a retry screen, not a verified one',
      () async {
        final backend = _Backend()..offline = true;
        final controller = _controller(backend);
        await controller.load();
        expect(controller.stage, OnboardingStage.loadFailed);
        expect(controller.error, contains('Could not reach AaminPay'));
      },
    );
  });

  group('what the app sends', () {
    test('the profile carries only the five profile fields', () async {
      final backend = _Backend();
      final controller = _controller(backend);
      await controller.saveProfile(
        const CustomerProfile(
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: '1990-04-12',
          countryOfResidence: 'GB',
          phone: '+447700900123',
        ),
      );
      final put = backend.requests.firstWhere((r) => r.method == 'PUT');
      expect((jsonDecode(put.body) as Map<String, dynamic>).keys.toSet(), {
        'firstName',
        'lastName',
        'dateOfBirth',
        'countryOfResidence',
        'phone',
      });
    });

    test(
      'starting the identity check sends no status and only calls our backend',
      () async {
        final backend = _Backend()
          ..profile = {'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5};
        final controller = _controller(backend);
        final url = await controller.startIdentityCheck();
        expect(url, _providerPage);

        final post = backend.requests.firstWhere((r) => r.method == 'POST');
        expect(post.body, '{}');
        expect(
          backend.requests.every((r) => r.url.host == _config.apiBaseUrl.host),
          isTrue,
        );
      },
    );

    test(
      'an unsupported country shows the friendly message on the field',
      () async {
        final backend = _Backend();
        final controller = _controller(backend);
        final ok = await controller.saveProfile(
          const CustomerProfile(
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: '1990-04-12',
            countryOfResidence: 'US',
            phone: '+447700900123',
          ),
        );
        expect(ok, isFalse);
        expect(controller.error, contains("can't offer transfers"));
        expect(
          controller.fieldErrors['countryOfResidence'],
          'Country not supported yet',
        );
      },
    );
  });

  group('the provider page', () {
    test('only secure pages load; plain http only in development', () {
      final https = Uri.parse('https://provider.example/kyc');
      final http_ = Uri.parse('http://10.0.2.2:3000/dev/mock/kyc');
      expect(isAllowedProviderNavigation(https, allowInsecure: false), isTrue);
      expect(isAllowedProviderNavigation(http_, allowInsecure: false), isFalse);
      expect(isAllowedProviderNavigation(http_, allowInsecure: true), isTrue);
      for (final other in [
        'javascript:alert(1)',
        'file:///etc/hosts',
        'intent://x',
      ]) {
        expect(
          isAllowedProviderNavigation(Uri.parse(other), allowInsecure: true),
          isFalse,
          reason: other,
        );
      }
    });

    test('the check is finished only when our own callback loads', () {
      final api = Uri.parse('https://api.almapay.example');
      expect(
        isOnboardingCallback(
          Uri.parse(
            'https://api.almapay.example/api/v1/onboarding/callback?state=s',
          ),
          api,
        ),
        isTrue,
      );
      expect(
        isOnboardingCallback(
          Uri.parse('https://evil.example/api/v1/onboarding/callback?state=s'),
          api,
        ),
        isFalse,
      );
      expect(
        isOnboardingCallback(
          Uri.parse('https://api.almapay.example/other'),
          api,
        ),
        isFalse,
      );
    });
  });

  group('screens', () {
    testWidgets(
      'a new customer confirms their email, gives a profile, verifies and can send',
      (tester) async {
        final backend = _Backend()..emailVerified = false;
        final harness = _Harness(backend);
        await harness.pump(tester);

        // 1. Verify email.
        expect(find.text('CHECK YOUR EMAIL'), findsOneWidget);
        expect(find.textContaining('jane@example.test'), findsWidgets);
        await _tap(tester, 'verify_email_resend');
        expect(harness.authRepository.resendCalls, 1);
        await tester.enterText(
          find.byKey(const Key('verify_email_code')),
          'https://app.almapay.example/verify-email?token=tok-123',
        );
        await _tap(tester, 'verify_email_submit_code');
        expect(harness.authRepository.verifiedWith, 'tok-123');

        // 2. Profile.
        expect(find.text('TELL US ABOUT YOU'), findsOneWidget);
        await _tap(tester, 'profile_submit');
        expect(find.text('Enter your first name'), findsOneWidget);
        expect(find.text('Enter your date of birth'), findsOneWidget);
        expect(backend.count('PUT', '/api/v1/profile'), 0);

        await _fillProfile(tester);
        await _tap(tester, 'profile_submit');
        expect(backend.profile, {
          'firstName': 'Jane',
          'lastName': 'Doe',
          'dateOfBirth': '1990-04-12',
          'countryOfResidence': 'GB',
          'phone': '+447700900123',
        });

        // 3. Verify your identity: explains, then opens the provider's page.
        expect(find.text('VERIFY YOUR IDENTITY'), findsOneWidget);
        expect(find.textContaining('payment partner'), findsOneWidget);
        expect(harness.opened, isEmpty);
        harness.onProviderPage = () => backend.status = 'VERIFIED';
        await _tap(tester, 'identity_start');
        expect(harness.opened, [_providerPage]);

        // 4. Verified – you can send money.
        expect(find.byKey(const Key('stage_verified')), findsOneWidget);
        expect(find.byKey(const Key('verified_send_money')), findsOneWidget);
      },
    );

    testWidgets('closing the provider page early shows "in progress"', (
      tester,
    ) async {
      final backend = _Backend()
        ..profile = {'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5};
      final harness = _Harness(backend);
      await harness.pump(tester);

      await _tap(tester, 'identity_start');
      expect(find.text('VERIFICATION IN PROGRESS'), findsOneWidget);
      expect(find.byKey(const Key('verified_send_money')), findsNothing);

      // They can go back to the provider's page, or check again later.
      await _tap(tester, 'in_progress_resume');
      expect(harness.opened.length, 2);
      backend.status = 'VERIFIED';
      await _tap(tester, 'in_progress_refresh');
      expect(find.byKey(const Key('stage_verified')), findsOneWidget);
    });

    testWidgets('a refusal tells the customer to contact support', (
      tester,
    ) async {
      for (final status in ['REJECTED', 'REJECTED_PENDING_REVIEW']) {
        final backend = _Backend()
          ..status = status
          ..profile = {'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5};
        await _Harness(backend).pump(tester);
        expect(find.text("WE COULDN'T VERIFY YOUR IDENTITY"), findsOneWidget);
        expect(find.textContaining('contact our support team'), findsOneWidget);
        expect(find.textContaining(_config.supportEmail), findsOneWidget);
        expect(find.byKey(const Key('verified_send_money')), findsNothing);
        expect(find.byKey(const Key('identity_start')), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
      }
    });

    testWidgets('a broken connection asks the customer to reconnect', (
      tester,
    ) async {
      final backend = _Backend()
        ..status = 'NEEDS_RELINK'
        ..profile = {'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5};
      final harness = _Harness(backend);
      await harness.pump(tester);

      expect(find.text('PLEASE RECONNECT YOUR ACCOUNT'), findsOneWidget);
      expect(find.byKey(const Key('verified_send_money')), findsNothing);

      harness.onProviderPage = () => backend.status = 'VERIFIED';
      await _tap(tester, 'reconnect_start');
      expect(harness.opened, [_providerPage]);
      expect(find.byKey(const Key('stage_verified')), findsOneWidget);
    });

    testWidgets('an unsupported country is explained on the profile form', (
      tester,
    ) async {
      final backend = _Backend()..supportedCountries = ['GB', 'US'];
      await _Harness(backend).pump(tester);

      await _fillProfile(tester);
      await _tap(tester, 'profile_country');
      await tester.tap(find.text('US').last);
      await tester.pumpAndSettle();
      await _tap(tester, 'profile_submit');

      expect(find.byKey(const Key('onboarding_error')), findsOneWidget);
      expect(find.textContaining("can't offer transfers"), findsOneWidget);
      expect(find.text('Country not supported yet'), findsOneWidget);
      expect(find.text('TELL US ABOUT YOU'), findsOneWidget);
    });

    testWidgets(
      'headings are exposed to screen readers and buttons are labelled',
      (tester) async {
        final handle = tester.ensureSemantics();
        final backend = _Backend()
          ..profile = {'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5};
        await _Harness(backend).pump(tester);

        expect(
          tester.getSemantics(find.text('VERIFY YOUR IDENTITY')),
          matchesSemantics(label: 'VERIFY YOUR IDENTITY', isHeader: true),
        );
        expect(find.bySemanticsLabel('Start identity check'), findsOneWidget);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      },
    );
  });
}
