import 'package:flutter/foundation.dart';

import '../../../core/network/api_exception.dart';
import '../domain/auth_repository.dart';
import '../domain/auth_user.dart';

enum AuthStatus { unknown, busy, authenticated, unauthenticated }

/// Holds authentication state for the app shell. A single instance lives for the
/// lifetime of the app.
class AuthController extends ChangeNotifier {
  AuthController(this._repository);

  final AuthRepository _repository;

  AuthStatus _status = AuthStatus.unknown;
  AuthUser? _user;
  String? _lastError;
  bool _totpRequired = false;

  AuthStatus get status => _status;
  AuthUser? get user => _user;
  String? get lastError => _lastError;

  /// True once the backend has said this account needs an authenticator code.
  bool get totpRequired => _totpRequired;
  bool get isAuthenticated => _status == AuthStatus.authenticated;

  /// Called on startup: restore a persisted session if there is one.
  Future<void> restoreSession() async {
    _setStatus(AuthStatus.busy);
    try {
      final user = await _repository.currentUser();
      _apply(user);
    } on ApiException {
      _apply(null);
    }
  }

  /// Signs in. The sign-in screen stays on display while this runs, so what
  /// the customer typed is kept if a second step (or a retry) is needed.
  Future<bool> login({
    required String email,
    required String password,
    String? totpCode,
  }) async {
    _lastError = null;
    try {
      final user = await _repository.login(
        email: email,
        password: password,
        totpCode: totpCode,
      );
      _totpRequired = false;
      _apply(user);
      return true;
    } on ApiException catch (error) {
      _lastError = error.message;
      // The password was right; the account also needs an authenticator code.
      _totpRequired =
          error.code == 'TOTP_REQUIRED' || (_totpRequired && totpCode != null);
      _apply(null);
      return false;
    }
  }

  /// Confirms the email address with the code from the verification email,
  /// then reloads the account. Returns `null` on success, or a message.
  Future<String?> verifyEmail(String token) async {
    try {
      await _repository.verifyEmail(token);
      await refreshUser();
      return null;
    } on ApiException catch (error) {
      return error.message;
    }
  }

  Future<String?> resendVerificationEmail() async {
    try {
      await _repository.resendVerificationEmail();
      return null;
    } on ApiException catch (error) {
      return error.message;
    }
  }

  /// Reloads the signed-in account, e.g. after the email link was opened on
  /// another device. Keeps the current account if the network is down.
  Future<void> refreshUser() async {
    try {
      final user = await _repository.currentUser();
      _apply(user);
    } on ApiException {
      // Keep what we have.
    }
  }

  /// Returns `null` on success, or a user-facing error message.
  Future<String?> register({
    required String email,
    required String password,
  }) async {
    try {
      await _repository.register(email: email, password: password);
      return null;
    } on ApiException catch (error) {
      return error.fieldErrors.isNotEmpty
          ? error.fieldErrors.first.message
          : error.message;
    }
  }

  Future<String?> requestPasswordReset(String email) async {
    try {
      await _repository.requestPasswordReset(email);
      return null;
    } on ApiException catch (error) {
      return error.message;
    }
  }

  Future<void> logout() async {
    try {
      await _repository.logout();
    } finally {
      _apply(null);
    }
  }

  /// Invoked by the token refresher when the session can no longer be renewed.
  void onSessionExpired() {
    if (_status != AuthStatus.unauthenticated) {
      _apply(null);
    }
  }

  void _apply(AuthUser? user) {
    _user = user;
    _status = user != null
        ? AuthStatus.authenticated
        : AuthStatus.unauthenticated;
    notifyListeners();
  }

  void _setStatus(AuthStatus status) {
    _status = status;
    notifyListeners();
  }
}
