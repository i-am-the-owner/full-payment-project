import 'onboarding_models.dart';

/// The onboarding operations the presentation layer depends on. Implemented in
/// the data layer; faked in tests.
///
/// There is deliberately no way to set the verification status: it only ever
/// comes from the payment provider, through the backend.
abstract interface class OnboardingRepository {
  Future<OnboardingStatus> getStatus();

  Future<ProfileForm> getProfileForm();

  Future<void> saveProfile(CustomerProfile profile);

  /// Asks the backend to begin (or resume) the provider's identity check.
  Future<OnboardingStart> startIdentityCheck();
}
