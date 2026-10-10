import 'package:flutter/material.dart';

import '../../../app/environment/app_config.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../onboarding/presentation/onboarding_controller.dart';
import '../../onboarding/presentation/onboarding_flow.dart';
import '../../onboarding/presentation/provider_web_view_page.dart';
import '../../send_money/presentation/send_money_controller.dart';
import '../../send_money/presentation/send_money_flow_page.dart';
import '../../send_money/presentation/transfer_history_page.dart';
import 'verified_shell.dart';

/// Authenticated landing screen. It walks a new customer through sign-up
/// (email, profile, identity check) and, once the payment provider has
/// verified them, offers sending money.
class HomePage extends StatelessWidget {
  const HomePage({
    required this.controller,
    required this.config,
    required this.onboarding,
    required this.sendMoney,
    this.openProviderPage,
    super.key,
  });

  final AuthController controller;
  final AppConfig config;
  final OnboardingController onboarding;
  final SendMoneyController sendMoney;

  /// Replaces the in-app web view, for tests.
  final ProviderPageOpener? openProviderPage;

  Future<void> _openProviderPage(BuildContext context, Uri url) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => ProviderWebViewPage(
          url: url,
          apiBaseUrl: config.apiBaseUrl,
          allowInsecure: !config.isProduction,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Once the payment partner has verified the customer, the app proper.
    return ListenableBuilder(
      listenable: onboarding,
      builder: (context, _) {
        if (onboarding.stage == OnboardingStage.verified) {
          return VerifiedShell(
            key: const Key('stage_verified'),
            auth: controller,
            config: config,
            sendMoney: sendMoney,
          );
        }
        return _signUpSteps(context);
      },
    );
  }

  Widget _signUpSteps(BuildContext context) {
    final user = controller.user;
    return Scaffold(
      appBar: AppBar(
        title: Text(config.appDisplayName),
        actions: [
          IconButton(
            key: const Key('sign_out'),
            onPressed: controller.logout,
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
          ),
        ],
      ),
      body: Column(
        children: [
          if (user != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
              child: Text(
                'Signed in as ${user.email}',
                key: const Key('signed_in_as'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          Expanded(
            child: OnboardingFlow(
              controller: onboarding,
              auth: controller,
              supportEmail: config.supportEmail,
              openProviderPage: openProviderPage ?? _openProviderPage,
              onSendMoney: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => SendMoneyFlowPage(
                    controller: sendMoney,
                    devTools: !config.isProduction,
                  ),
                ),
              ),
              onViewTransfers: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => TransferHistoryPage(
                    controller: sendMoney,
                    devTools: !config.isProduction,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
