import 'package:flutter/foundation.dart';

/// The customer's verification status with the payment provider, exactly as
/// the backend reports it. The app only ever reads this; it cannot set it.
enum KycStatus {
  unverified,
  pending,
  verified,
  rejected,
  rejectedPendingReview,
  needsRelink;

  static KycStatus parse(String? value) => switch (value) {
    'PENDING' => KycStatus.pending,
    'VERIFIED' => KycStatus.verified,
    'REJECTED' => KycStatus.rejected,
    'REJECTED_PENDING_REVIEW' => KycStatus.rejectedPendingReview,
    'NEEDS_RELINK' => KycStatus.needsRelink,
    // Anything unknown is treated as not verified.
    _ => KycStatus.unverified,
  };
}

/// Where the customer is in sign-up, from `GET /api/v1/onboarding/status`.
@immutable
class OnboardingStatus {
  const OnboardingStatus({
    required this.status,
    required this.emailVerified,
    required this.profileComplete,
  });

  final KycStatus status;
  final bool emailVerified;
  final bool profileComplete;

  factory OnboardingStatus.fromJson(Map<String, dynamic> json) =>
      OnboardingStatus(
        status: KycStatus.parse(json['status'] as String?),
        emailVerified: json['emailVerified'] as bool? ?? false,
        profileComplete: json['profileComplete'] as bool? ?? false,
      );
}

/// The details the customer gives us about themselves.
@immutable
class CustomerProfile {
  const CustomerProfile({
    required this.firstName,
    required this.lastName,
    required this.dateOfBirth,
    required this.countryOfResidence,
    required this.phone,
  });

  final String firstName;
  final String lastName;

  /// ISO date, `YYYY-MM-DD`.
  final String dateOfBirth;

  /// ISO 3166-1 alpha-2 country code.
  final String countryOfResidence;

  /// International format, e.g. `+447700900123`.
  final String phone;

  Map<String, dynamic> toJson() => {
    'firstName': firstName,
    'lastName': lastName,
    'dateOfBirth': dateOfBirth,
    'countryOfResidence': countryOfResidence,
    'phone': phone,
  };
}

/// What we hold so far, and the countries the provider accepts senders from.
@immutable
class ProfileForm {
  const ProfileForm({required this.values, required this.supportedCountries});

  /// Saved values by field name; fields not yet given are absent.
  final Map<String, String> values;
  final List<String> supportedCountries;

  factory ProfileForm.fromJson(Map<String, dynamic> json) => ProfileForm(
    values: ((json['profile'] as Map<String, dynamic>?) ?? const {}).map(
      (key, value) => MapEntry(key, '$value'),
    ),
    supportedCountries:
        ((json['supportedCountries'] as List<dynamic>?) ?? const [])
            .map((e) => e as String)
            .toList(growable: false),
  );
}

/// The result of asking to start the provider's identity check.
@immutable
class OnboardingStart {
  const OnboardingStart.redirect(Uri this.url) : status = null;
  const OnboardingStart.done(KycStatus this.status) : url = null;

  /// The provider's page to open, when there is one.
  final Uri? url;

  /// The status, when no page needs opening.
  final KycStatus? status;

  factory OnboardingStart.fromJson(Map<String, dynamic> json) =>
      json['kind'] == 'redirect'
      ? OnboardingStart.redirect(Uri.parse(json['url'] as String))
      : OnboardingStart.done(KycStatus.parse(json['status'] as String?));
}
