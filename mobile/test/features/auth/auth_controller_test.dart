import 'package:almapay/core/network/api_exception.dart';
import 'package:almapay/features/auth/domain/auth_repository.dart';
import 'package:almapay/features/auth/domain/auth_user.dart';
import 'package:almapay/features/auth/presentation/auth_controller.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeAuthRepository implements AuthRepository {
  AuthUser? currentUserResult;
  Object? currentUserError;
  AuthUser? loginResult;
  Object? loginError;
  Object? registerError;
  int logoutCalls = 0;

  @override
  Future<AuthUser?> currentUser() async {
    if (currentUserError != null) throw currentUserError!;
    return currentUserResult;
  }

  @override
  Future<AuthUser> login({
    required String email,
    required String password,
    String? totpCode,
  }) async {
    lastTotpCode = totpCode;
    if (totpCode == null && totpRequired) {
      throw ApiException(
        statusCode: 401,
        code: 'TOTP_REQUIRED',
        message: 'Enter the 6-digit code from your authenticator app.',
      );
    }
    if (loginError != null) throw loginError!;
    return loginResult!;
  }

  bool totpRequired = false;
  String? lastTotpCode;
  String? verifiedWith;
  int resendCalls = 0;

  @override
  Future<void> verifyEmail(String token) async {
    verifiedWith = token;
  }

  @override
  Future<void> resendVerificationEmail() async {
    resendCalls++;
  }

  @override
  Future<void> register({
    required String email,
    required String password,
  }) async {
    if (registerError != null) throw registerError!;
  }

  @override
  Future<void> requestPasswordReset(String email) async {}

  @override
  Future<void> logout() async {
    logoutCalls++;
  }
}

const _user = AuthUser(
  id: 'u1',
  email: 'user@example.test',
  emailVerified: false,
  roles: ['customer'],
);

ApiException _unauthorized() => ApiException(
  statusCode: 401,
  code: 'UNAUTHORIZED',
  message: 'Invalid email or password.',
);

void main() {
  test('starts in the unknown state', () {
    final controller = AuthController(_FakeAuthRepository());
    expect(controller.status, AuthStatus.unknown);
  });

  test('restoreSession → authenticated when a session exists', () async {
    final repo = _FakeAuthRepository()..currentUserResult = _user;
    final controller = AuthController(repo);

    await controller.restoreSession();

    expect(controller.status, AuthStatus.authenticated);
    expect(controller.user, _user);
  });

  test('restoreSession → unauthenticated when there is no session', () async {
    final controller = AuthController(_FakeAuthRepository());
    await controller.restoreSession();
    expect(controller.status, AuthStatus.unauthenticated);
  });

  test('login success authenticates and notifies listeners', () async {
    final repo = _FakeAuthRepository()..loginResult = _user;
    final controller = AuthController(repo);
    var notified = 0;
    controller.addListener(() => notified++);

    final ok = await controller.login(
      email: 'a@b.test',
      password: 'a strong passphrase',
    );

    expect(ok, isTrue);
    expect(controller.status, AuthStatus.authenticated);
    expect(notified, greaterThanOrEqualTo(1));
  });

  test(
    'login failure surfaces the message and stays unauthenticated',
    () async {
      final repo = _FakeAuthRepository()..loginError = _unauthorized();
      final controller = AuthController(repo);

      final ok = await controller.login(email: 'a@b.test', password: 'wrong');

      expect(ok, isFalse);
      expect(controller.status, AuthStatus.unauthenticated);
      expect(controller.lastError, 'Invalid email or password.');
    },
  );

  test(
    'register returns the field error message on validation failure',
    () async {
      final repo = _FakeAuthRepository()
        ..registerError = ApiException(
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          fieldErrors: const [
            ApiFieldError(
              field: 'body.password',
              message: 'Must be at least 12 characters.',
            ),
          ],
        );
      final controller = AuthController(repo);

      final error = await controller.register(
        email: 'a@b.test',
        password: 'short',
      );
      expect(error, 'Must be at least 12 characters.');
    },
  );

  test('logout clears state', () async {
    final repo = _FakeAuthRepository()..loginResult = _user;
    final controller = AuthController(repo);
    await controller.login(email: 'a@b.test', password: 'a strong passphrase');

    await controller.logout();

    expect(repo.logoutCalls, 1);
    expect(controller.status, AuthStatus.unauthenticated);
    expect(controller.user, isNull);
  });

  test('onSessionExpired drops an authenticated session', () async {
    final repo = _FakeAuthRepository()..loginResult = _user;
    final controller = AuthController(repo);
    await controller.login(email: 'a@b.test', password: 'a strong passphrase');

    controller.onSessionExpired();

    expect(controller.status, AuthStatus.unauthenticated);
  });

  test(
    'an account with two-step sign-in asks for a code, then signs in',
    () async {
      final repo = _FakeAuthRepository()
        ..totpRequired = true
        ..loginResult = _user;
      final controller = AuthController(repo);

      final first = await controller.login(
        email: 'a@b.test',
        password: 'a strong passphrase',
      );
      expect(first, isFalse);
      expect(controller.totpRequired, isTrue);
      expect(controller.status, AuthStatus.unauthenticated);
      expect(controller.lastError, contains('6-digit code'));

      final second = await controller.login(
        email: 'a@b.test',
        password: 'a strong passphrase',
        totpCode: '123456',
      );
      expect(second, isTrue);
      expect(repo.lastTotpCode, '123456');
      expect(controller.totpRequired, isFalse);
      expect(controller.status, AuthStatus.authenticated);
    },
  );

  test('a wrong password does not ask for a code', () async {
    final repo = _FakeAuthRepository()..loginError = _unauthorized();
    final controller = AuthController(repo);
    await controller.login(email: 'a@b.test', password: 'wrong');
    expect(controller.totpRequired, isFalse);
  });

  test('verifying the email reloads the account', () async {
    final repo = _FakeAuthRepository()..currentUserResult = _user;
    final controller = AuthController(repo);
    await controller.restoreSession();
    expect(controller.user?.emailVerified, isFalse);

    repo.currentUserResult = const AuthUser(
      id: 'u1',
      email: 'user@example.test',
      emailVerified: true,
      roles: ['customer'],
    );
    expect(await controller.verifyEmail('token-from-email'), isNull);
    expect(repo.verifiedWith, 'token-from-email');
    expect(controller.user?.emailVerified, isTrue);

    expect(await controller.resendVerificationEmail(), isNull);
    expect(repo.resendCalls, 1);
  });
}
