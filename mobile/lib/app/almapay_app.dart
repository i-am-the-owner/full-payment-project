import 'package:flutter/material.dart';

import '../core/auth/auth_dependencies.dart';
import '../features/auth/presentation/auth_gate.dart';
import '../features/onboarding/data/onboarding_api.dart';
import '../features/onboarding/presentation/onboarding_controller.dart';
import '../features/security/biometric_lock.dart';
import '../features/send_money/data/send_money_api.dart';
import '../features/send_money/data/send_money_repository_impl.dart';
import '../features/send_money/presentation/send_money_controller.dart';
import '../shared/theme/almapay_theme.dart';
import 'environment/app_config.dart';
import 'theme_mode_controller.dart';

/// Root widget of the AaminPay app. Receives a fully-resolved [AppConfig] and the
/// authentication graph so that configuration and dependencies are injected once,
/// at the top, rather than read ad hoc.
class AlmaPayApp extends StatefulWidget {
  const AlmaPayApp({
    required this.config,
    required this.auth,
    this.biometrics,
    super.key,
  });

  final AppConfig config;
  final AuthDependencies auth;

  /// The fingerprint lock; the real device one when omitted.
  final BiometricLockController? biometrics;

  @override
  State<AlmaPayApp> createState() => _AlmaPayAppState();
}

class _AlmaPayAppState extends State<AlmaPayApp> {
  late final OnboardingController _onboarding;
  late final SendMoneyController _sendMoney;
  late final BiometricLockController _biometrics;
  late final ThemeModeController _theme;
  String? _signedInUserId;

  @override
  void initState() {
    super.initState();
    // Every call goes to the AaminPay backend; the app never talks to a
    // payment provider's API.
    _onboarding = OnboardingController(
      OnboardingApi(
        baseUrl: widget.config.apiBaseUrl,
        client: widget.auth.apiClient,
      ),
    );
    _sendMoney = SendMoneyController(
      SendMoneyRepositoryImpl(
        api: SendMoneyApi(
          baseUrl: widget.config.apiBaseUrl,
          client: widget.auth.apiClient,
        ),
      ),
    );
    _biometrics =
        widget.biometrics ??
        BiometricLockController(
          authenticator: DeviceBiometricAuthenticator(),
          store: SecureBiometricPreferenceStore(),
        );
    _biometrics.init();
    _theme = ThemeModeController(SecureThemeModeStore())..init();
    widget.auth.authController.addListener(_onAuthChanged);
    // Restore a persisted session before the first frame settles.
    widget.auth.authController.restoreSession();
  }

  /// Whenever the signed-in account changes (including sign-out), drop the
  /// previous customer's people, progress and half-made transfer.
  void _onAuthChanged() {
    final id = widget.auth.authController.user?.id;
    if (id == _signedInUserId) return;
    _signedInUserId = id;
    _onboarding.clear();
    _sendMoney.clearCustomerData();
  }

  @override
  void dispose() {
    widget.auth.authController.removeListener(_onAuthChanged);
    _onboarding.dispose();
    _sendMoney.dispose();
    _biometrics.dispose();
    _theme.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ThemeScope(
      controller: _theme,
      child: ListenableBuilder(
        listenable: _theme,
        builder: (context, _) => MaterialApp(
          title: widget.config.appDisplayName,
          theme: AlmaPayTheme.light(),
          darkTheme: AlmaPayTheme.dark(),
          themeMode: _theme.mode,
          debugShowCheckedModeBanner: !widget.config.isProduction,
          home: AuthGate(
            controller: widget.auth.authController,
            config: widget.config,
            onboarding: _onboarding,
            sendMoney: _sendMoney,
            biometrics: _biometrics,
          ),
        ),
      ),
    );
  }
}
