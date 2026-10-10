import 'package:flutter/material.dart';

import '../../../app/environment/app_config.dart';
import '../../home/presentation/home_page.dart';
import '../../onboarding/presentation/onboarding_controller.dart';
import '../../onboarding/presentation/onboarding_flow.dart';
import '../../security/biometric_lock.dart';
import '../../send_money/presentation/send_money_controller.dart';
import 'auth_controller.dart';
import 'login_page.dart';

/// Chooses the screen for the current [AuthStatus] and rebuilds when it changes.
class AuthGate extends StatelessWidget {
  const AuthGate({
    required this.controller,
    required this.config,
    required this.onboarding,
    required this.sendMoney,
    this.openProviderPage,
    this.biometrics,
    super.key,
  });

  final AuthController controller;
  final AppConfig config;
  final OnboardingController onboarding;
  final SendMoneyController sendMoney;

  /// Replaces the in-app web view, for tests.
  final ProviderPageOpener? openProviderPage;

  /// The fingerprint lock. Null in tests that do not exercise it.
  final BiometricLockController? biometrics;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        switch (controller.status) {
          case AuthStatus.unknown:
          case AuthStatus.busy:
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          case AuthStatus.authenticated:
            final home = HomePage(
              // A different account starts sign-up from its own beginning.
              key: ValueKey(controller.user?.id),
              controller: controller,
              config: config,
              onboarding: onboarding,
              sendMoney: sendMoney,
              openProviderPage: openProviderPage,
              biometrics: biometrics,
            );
            final lock = biometrics;
            return lock == null
                ? home
                : BiometricLockGate(controller: lock, child: home);
          case AuthStatus.unauthenticated:
            return LoginPage(controller: controller);
        }
      },
    );
  }
}
