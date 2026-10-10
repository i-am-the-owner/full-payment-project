import 'package:flutter/foundation.dart';

/// The authenticated user's own account, as returned by `GET /api/v1/me`.
@immutable
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.emailVerified,
    required this.roles,
  });

  final String id;
  final String email;
  final bool emailVerified;
  final List<String> roles;

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
    id: json['id'] as String,
    email: json['email'] as String,
    emailVerified: json['emailVerified'] as bool? ?? false,
    roles: (json['roles'] as List<dynamic>? ?? const [])
        .map((role) => role as String)
        .toList(growable: false),
  );

  @override
  bool operator ==(Object other) =>
      other is AuthUser &&
      other.id == id &&
      other.email == email &&
      other.emailVerified == emailVerified;

  @override
  int get hashCode => Object.hash(id, email, emailVerified);
}
