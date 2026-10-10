import 'auth_user.dart';

/// The auth operations the presentation layer depends on. Implemented in the
/// data layer; faked in tests.
abstract interface class AuthRepository {
  /// Registers an account. The backend responds 202 and emails a verification
  /// link; it does not sign the user in.
  Future<void> register({required String email, required String password});

  /// Signs in and persists the session. Returns the authenticated account.
  /// [totpCode] is needed only when two-step sign-in is on for the account.
  Future<AuthUser> login({
    required String email,
    required String password,
    String? totpCode,
  });

  /// Confirms the email address with the code from the verification email.
  Future<void> verifyEmail(String token);

  /// Sends the verification email again to the signed-in account.
  Future<void> resendVerificationEmail();

  Future<void> requestPasswordReset(String email);

  /// Revokes the current session on the backend and clears local tokens.
  Future<void> logout();

  /// Returns the account for a stored session, or `null` if there is none / it
  /// is no longer valid (in which case local tokens are cleared).
  Future<AuthUser?> currentUser();
}
