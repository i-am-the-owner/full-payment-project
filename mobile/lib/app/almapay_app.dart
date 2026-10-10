import 'package:flutter/material.dart';

import '../core/auth/auth_dependencies.dart';
import '../features/auth/presentation/auth_gate.dart';
import '../features/onboarding/data/onboarding_api.dart';
import '../features/onboarding/presentation/onboarding_controller.dart';
import '../features/send_money/data/send_money_api.dart';
import '../features/send_money/data/send_money_repository_impl.dart';
import '../features/send_money/presentation/send_money_controller.dart';
import '../shared/theme/almapay_theme.dart';
import 'environment/app_config.dart';

/// Root widget of the AaminPay app. Receives a fully-resolved [AppConfig] and the
/// authentication graph so that configuration and dependencies are injected once,
/// at the top, rather than read ad hoc.
class AlmaPayApp extends StatefulWidget {
  const AlmaPayApp({required this.config, required this.auth, super.key});

  final AppConfig config;
  final AuthDependencies auth;

  @override
  State<AlmaPayApp> createState() => _AlmaPayAppState();
}

class _AlmaPayAppState extends State<AlmaPayApp> {
  late final OnboardingController _onboarding;
  late final SendMoneyController _sendMoney;

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
    // Restore a persisted session before the first frame settles.
    widget.auth.authController.restoreSession();
  }

  @override
  void dispose() {
    _onboarding.dispose();
    _sendMoney.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: widget.config.appDisplayName,
      theme: AlmaPayTheme.light(),
      darkTheme: AlmaPayTheme.dark(),
      debugShowCheckedModeBanner: !widget.config.isProduction,
      home: AuthGate(
        controller: widget.auth.authController,
        config: widget.config,
        onboarding: _onboarding,
        sendMoney: _sendMoney,
      ),
    );
  }
}
