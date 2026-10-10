import 'package:flutter/foundation.dart';

/// The credential pair issued by the backend. Held in memory only transiently;
/// the durable copy lives in [SecureTokenStore].
@immutable
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;

  AuthTokens copyWith({String? accessToken, String? refreshToken}) =>
      AuthTokens(
        accessToken: accessToken ?? this.accessToken,
        refreshToken: refreshToken ?? this.refreshToken,
      );

  @override
  bool operator ==(Object other) =>
      other is AuthTokens &&
      other.accessToken == accessToken &&
      other.refreshToken == refreshToken;

  @override
  int get hashCode => Object.hash(accessToken, refreshToken);

  /// Never include token values in diagnostics.
  @override
  String toString() => 'AuthTokens(access: <redacted>, refresh: <redacted>)';
}
