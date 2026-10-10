import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../../auth/presentation/auth_controller.dart';
import 'onboarding_controller.dart';
import 'profile_form.dart';

/// Opens the provider's identity-check page and completes when it is closed.
typedef ProviderPageOpener = Future<void> Function(
  BuildContext context,
  Uri url,
);

/// Takes a signed-in customer from "account created" to "can send money":
/// confirm email, give profile details, then the provider's identity check.
///
/// Which screen shows is decided by the backend's answer alone.
class OnboardingFlow extends StatefulWidget {
  const OnboardingFlow({
    required this.controller,
    required this.auth,
    required this.openProviderPage,
    required this.onSendMoney,
    required this.supportEmail,
    this.onViewTransfers,
    super.key,
  });

  final OnboardingController controller;
  final AuthController auth;
  final ProviderPageOpener openProviderPage;
  final VoidCallback onSendMoney;

  /// Opens the customer's past transfers, when the host offers that.
  final VoidCallback? onViewTransfers;
  final String supportEmail;

  @override
  State<OnboardingFlow> createState() => _OnboardingFlowState();
}

class _OnboardingFlowState extends State<OnboardingFlow> {
  final _emailCode = TextEditingController();
  String? _notice;

  @override
  void initState() {
    super.initState();
    // After the first frame: loading notifies listeners, and the home page
    // rebuilds on those.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.controller.load();
    });
  }

  @override
  void dispose() {
    _emailCode.dispose();
    super.dispose();
  }

  Future<void> _startIdentityCheck() async {
    final url = await widget.controller.startIdentityCheck();
    if (url == null || !mounted) {
      return;
    }
    await widget.openProviderPage(context, url);
    // Whatever happened on the provider's page, ask the backend for the result.
    await widget.controller.load();
  }

  Future<void> _confirmEmailWithCode() async {
    // Accept either the code itself or the whole link from the email.
    final typed = _emailCode.text.trim();
    final token = Uri.tryParse(typed)?.queryParameters['token'] ?? typed;
    if (token.isEmpty) {
      setState(() => _notice = 'Paste the link or code from the email.');
      return;
    }
    final error = await widget.auth.verifyEmail(token);
    if (!mounted) return;
    setState(() => _notice = error);
    if (error == null) {
      await widget.controller.load();
    }
  }

  Future<void> _resendEmail() async {
    final error = await widget.auth.resendVerificationEmail();
    if (!mounted) return;
    setState(
      () =>
          _notice = error ?? 'We have sent the email again. Check your inbox.',
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;
        if (controller.stage == OnboardingStage.loading) {
          return Center(
            child: Semantics(
              label: 'Loading',
              child: const CircularProgressIndicator(),
            ),
          );
        }
        return SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(22, 16, 22, 24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (controller.error != null) ...[
                      _Message(
                        key: const Key('onboarding_error'),
                        text: controller.error!,
                        isError: true,
                      ),
                      const SizedBox(height: 16),
                    ],
                    _stage(context, controller),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _stage(BuildContext context, OnboardingController controller) {
    switch (controller.stage) {
      case OnboardingStage.loading:
        return const SizedBox.shrink();

      case OnboardingStage.loadFailed:
        return _Screen(
          key: const Key('stage_load_failed'),
          icon: Icons.cloud_off_outlined,
          title: "We couldn't load your account",
          body: const ['Check your connection and try again.'],
          primaryLabel: 'Try again',
          primaryKey: const Key('onboarding_retry'),
          onPrimary: controller.busy ? null : controller.load,
        );

      case OnboardingStage.verifyEmail:
        final email = widget.auth.user?.email;
        return _Screen(
          key: const Key('stage_verify_email'),
          icon: Icons.mark_email_unread_outlined,
          title: 'Check your email',
          body: [
            email == null
                ? 'We sent you an email with a link.'
                : 'We sent an email with a link to $email.',
            'Open the link to confirm your email address, then come back here.',
          ],
          primaryLabel: "I've confirmed my email",
          primaryKey: const Key('verify_email_done'),
          onPrimary: controller.busy ? null : controller.load,
          secondaryLabel: 'Send the email again',
          secondaryKey: const Key('verify_email_resend'),
          onSecondary: _resendEmail,
          extra: [
            if (_notice != null) ...[
              _Message(key: const Key('verify_email_notice'), text: _notice!),
              const SizedBox(height: 12),
            ],
            TextField(
              key: const Key('verify_email_code'),
              controller: _emailCode,
              decoration: const InputDecoration(
                labelText: 'Or paste the link from the email',
              ),
              autocorrect: false,
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              key: const Key('verify_email_submit_code'),
              onPressed: _confirmEmailWithCode,
              child: const Text('Confirm with this link'),
            ),
          ],
        );

      case OnboardingStage.profile:
        return ProfileFormView(
          key: const Key('stage_profile'),
          controller: controller,
        );

      case OnboardingStage.verifyIdentity:
        return _Screen(
          key: const Key('stage_verify_identity'),
          icon: Icons.badge_outlined,
          title: 'Verify your identity',
          body: const [
            'Before you can send money, we need to check who you are. '
                'This is a legal requirement and keeps your money safe.',
            'The check is run by our payment partner, who is regulated to do '
                'this. It opens on their secure page.',
            'You may be asked to take a photo of your ID and of your face, '
                'so your phone will ask to use the camera. It usually takes a '
                'few minutes.',
          ],
          primaryLabel: 'Start identity check',
          primaryKey: const Key('identity_start'),
          onPrimary: controller.busy ? null : _startIdentityCheck,
        );

      case OnboardingStage.inProgress:
        return _Screen(
          key: const Key('stage_in_progress'),
          icon: Icons.hourglass_top_outlined,
          title: 'Verification in progress',
          body: const [
            'Thank you. Your details are being checked.',
            'This often takes a few minutes, and sometimes longer. You do not '
                'need to keep this screen open.',
          ],
          primaryLabel: 'Check again',
          primaryKey: const Key('in_progress_refresh'),
          onPrimary: controller.busy ? null : controller.load,
          secondaryLabel: "I haven't finished the identity check",
          secondaryKey: const Key('in_progress_resume'),
          onSecondary: controller.busy ? null : _startIdentityCheck,
        );

      case OnboardingStage.verified:
        return _Screen(
          key: const Key('stage_verified'),
          icon: Icons.verified_outlined,
          title: "You're verified",
          body: const ['You can send money now.'],
          primaryLabel: 'Send money',
          primaryKey: const Key('verified_send_money'),
          onPrimary: widget.onSendMoney,
          secondaryLabel: widget.onViewTransfers == null
              ? null
              : 'Your transfers',
          secondaryKey: const Key('verified_view_transfers'),
          onSecondary: widget.onViewTransfers,
        );

      case OnboardingStage.couldNotVerify:
        return _Screen(
          key: const Key('stage_could_not_verify'),
          icon: Icons.report_gmailerrorred_outlined,
          title: "We couldn't verify your identity",
          body: [
            "Sorry, this means you can't send money with AaminPay at the moment.",
            'Please contact our support team and we will look into it with you.',
            'Email: ${widget.supportEmail}',
          ],
          primaryLabel: 'Check again',
          primaryKey: const Key('could_not_verify_refresh'),
          onPrimary: controller.busy ? null : controller.load,
        );

      case OnboardingStage.reconnect:
        return _Screen(
          key: const Key('stage_reconnect'),
          icon: Icons.link_off_outlined,
          title: 'Please reconnect your account',
          body: const [
            'Your connection to our payment partner has ended. This can happen '
                'from time to time to keep your account secure.',
            'Reconnect to carry on sending money. Your past transfers are '
                'not affected.',
          ],
          primaryLabel: 'Reconnect',
          primaryKey: const Key('reconnect_start'),
          onPrimary: controller.busy ? null : _startIdentityCheck,
        );
    }
  }
}

/// One explanatory screen: a heading, plain-English paragraphs and actions.
class _Screen extends StatelessWidget {
  const _Screen({
    required this.icon,
    required this.title,
    required this.body,
    required this.primaryLabel,
    required this.primaryKey,
    required this.onPrimary,
    this.secondaryLabel,
    this.secondaryKey,
    this.onSecondary,
    this.extra = const [],
    super.key,
  });

  final IconData icon;
  final String title;
  final List<String> body;
  final String primaryLabel;
  final Key primaryKey;
  final VoidCallback? onPrimary;
  final String? secondaryLabel;
  final Key? secondaryKey;
  final VoidCallback? onSecondary;
  final List<Widget> extra;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Decorative: the heading says the same thing in words.
        ExcludeSemantics(
          child: Align(
            alignment: Alignment.centerLeft,
            child: Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: AlmaPayColours.blueSoft,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Icon(icon, size: 32, color: AlmaPayColours.blue),
            ),
          ),
        ),
        const SizedBox(height: 18),
        Semantics(
          header: true,
          child: Text(
            title.toUpperCase(),
            style: AlmaPayText.display.copyWith(fontSize: 38, height: .95),
          ),
        ),
        const SizedBox(height: 12),
        for (final paragraph in body)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: SelectableText(
              paragraph,
              style: AlmaPayText.ui(size: 16, color: AlmaPayColours.ink2),
            ),
          ),
        const SizedBox(height: 12),
        FilledButton(
          key: primaryKey,
          onPressed: onPrimary,
          child: Text(primaryLabel),
        ),
        if (secondaryLabel != null) ...[
          const SizedBox(height: 8),
          TextButton(
            key: secondaryKey,
            onPressed: onSecondary,
            style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: Text(secondaryLabel!),
          ),
        ],
        if (extra.isNotEmpty) ...[const SizedBox(height: 16), ...extra],
      ],
    );
  }
}

/// A short status or error message, announced by screen readers when it appears.
class _Message extends StatelessWidget {
  const _Message({required this.text, this.isError = false, super.key});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isError ? AlmaPayColours.badSoft : AlmaPayColours.blueSoft,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          text,
          style: AlmaPayText.ui(
            size: 14.5,
            weight: 500,
            color: isError ? AlmaPayColours.bad : AlmaPayColours.ink,
          ),
        ),
      ),
    );
  }
}
