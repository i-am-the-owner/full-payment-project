import 'package:flutter/foundation.dart';

import '../../../core/network/api_exception.dart';
import '../domain/onboarding_models.dart';
import '../domain/onboarding_repository.dart';

/// The screen the customer should see. Derived only from what the backend
/// reports – never from anything the app decides for itself.
enum OnboardingStage {
  loading,
  loadFailed,
  verifyEmail,
  profile,
  verifyIdentity,
  inProgress,
  verified,
  couldNotVerify,
  reconnect,
}

/// Drives sign-up after the account exists: email, profile, identity check.
class OnboardingController extends ChangeNotifier {
  OnboardingController(this._repository);

  final OnboardingRepository _repository;

  OnboardingStage _stage = OnboardingStage.loading;
  ProfileForm? _profileForm;
  bool _busy = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  OnboardingStage get stage => _stage;
  ProfileForm? get profileForm => _profileForm;
  bool get busy => _busy;

  /// A message to show the customer, in plain English.
  String? get error => _error;

  /// Server-side problems by field name (`firstName`, `phone`, ...).
  Map<String, String> get fieldErrors => _fieldErrors;

  /// Forgets the previous customer's progress, so a new sign-in starts at
  /// `loading` and is checked with the backend, never shown as already verified.
  void clear() {
    _stage = OnboardingStage.loading;
    _profileForm = null;
    _busy = false;
    _error = null;
    _fieldErrors = const {};
    notifyListeners();
  }

  /// Asks the backend where the customer is, and picks the screen for it.
  Future<void> load({bool showSpinner = true}) async {
    _error = null;
    if (showSpinner) {
      _stage = OnboardingStage.loading;
    }
    _busy = true;
    notifyListeners();
    try {
      final status = await _repository.getStatus();
      final stage = _stageFor(status);
      if (stage == OnboardingStage.profile) {
        _profileForm = await _repository.getProfileForm();
      }
      _stage = stage;
    } on ApiException catch (error) {
      _error = error.message;
      if (_stage == OnboardingStage.loading) {
        _stage = OnboardingStage.loadFailed;
      }
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// Saves the profile. Returns true when it was accepted.
  Future<bool> saveProfile(CustomerProfile profile) async {
    _error = null;
    _fieldErrors = const {};
    _busy = true;
    notifyListeners();
    try {
      await _repository.saveProfile(profile);
    } on ApiException catch (error) {
      _error = error.message;
      _fieldErrors = {
        for (final e in error.fieldErrors)
          e.field.replaceFirst('body.', ''): e.message,
      };
      _busy = false;
      notifyListeners();
      return false;
    }
    await load(showSpinner: false);
    return true;
  }

  /// Starts the provider's identity check. Returns the provider page to open,
  /// or null when there is nothing to open (the stage has been updated).
  Future<Uri?> startIdentityCheck() async {
    _error = null;
    _busy = true;
    notifyListeners();
    try {
      final started = await _repository.startIdentityCheck();
      if (started.url != null) {
        return started.url;
      }
      await load(showSpinner: false);
      return null;
    } on ApiException catch (error) {
      _error = error.message;
      return null;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  static OnboardingStage _stageFor(OnboardingStatus status) {
    if (!status.emailVerified) {
      return OnboardingStage.verifyEmail;
    }
    switch (status.status) {
      case KycStatus.verified:
        return OnboardingStage.verified;
      case KycStatus.needsRelink:
        return OnboardingStage.reconnect;
      case KycStatus.rejected:
      case KycStatus.rejectedPendingReview:
        return OnboardingStage.couldNotVerify;
      case KycStatus.pending:
        return status.profileComplete
            ? OnboardingStage.inProgress
            : OnboardingStage.profile;
      case KycStatus.unverified:
        return status.profileComplete
            ? OnboardingStage.verifyIdentity
            : OnboardingStage.profile;
    }
  }
}
