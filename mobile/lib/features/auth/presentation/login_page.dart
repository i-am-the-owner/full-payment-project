import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../../../shared/widgets/aamin_mark.dart';
import '../../../shared/widgets/welcome_tickets.dart';
import 'auth_controller.dart';
import 'register_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({required this.controller, super.key});

  final AuthController controller;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _submitting = true);
    final ok = await widget.controller.login(
      email: _email.text.trim(),
      password: _password.text,
      totpCode: widget.controller.totpRequired ? _code.text.trim() : null,
    );
    if (!mounted) {
      return;
    }
    setState(() => _submitting = false);
    if (!ok) {
      final message = widget.controller.lastError ?? 'Sign in failed.';
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  bool _showPassword = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.palette.background,
      body: Column(
        children: [
          const _AuthHeader(),
          Expanded(
            child: SafeArea(
              top: false,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(22, 22, 22, 24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'WELCOME BACK',
                        style: AlmaPayText.display.copyWith(fontSize: 40),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        key: const Key('login_email'),
                        controller: _email,
                        decoration: const InputDecoration(
                          labelText: 'Email',
                          prefixIcon: Icon(Icons.mail_outline),
                        ),
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.username],
                        validator: (value) =>
                            (value == null || !value.contains('@'))
                            ? 'Enter your email'
                            : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        key: const Key('login_password'),
                        controller: _password,
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            tooltip: _showPassword
                                ? 'Hide password'
                                : 'Show password',
                            icon: Icon(
                              _showPassword
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                            ),
                            onPressed: () =>
                                setState(() => _showPassword = !_showPassword),
                          ),
                        ),
                        obscureText: !_showPassword,
                        autofillHints: const [AutofillHints.password],
                        validator: (value) => (value == null || value.isEmpty)
                            ? 'Enter your password'
                            : null,
                      ),
                      if (widget.controller.totpRequired) ...[
                        const SizedBox(height: 14),
                        TextFormField(
                          key: const Key('login_totp_code'),
                          controller: _code,
                          decoration: const InputDecoration(
                            labelText: '6-digit code',
                            helperText:
                                'Open your authenticator app to get the code',
                          ),
                          keyboardType: TextInputType.number,
                          autofillHints: const [AutofillHints.oneTimeCode],
                          maxLength: 6,
                          validator: (value) =>
                              RegExp(r'^\d{6}$').hasMatch((value ?? '').trim())
                              ? null
                              : 'Enter the 6-digit code',
                        ),
                      ],
                      const SizedBox(height: 28),
                      FilledButton(
                        key: const Key('login_submit'),
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Theme.of(context)
                                      .colorScheme
                                      .onPrimary,
                                ),
                              )
                            : const Text('Log in'),
                      ),
                      const SizedBox(height: 14),
                      Center(
                        child: Text.rich(
                          TextSpan(
                            text: 'New to AaminPay? ',
                            style: AlmaPayText.ui(
                              size: 15,
                              color: context.palette.muted,
                            ),
                            children: [
                              WidgetSpan(
                                alignment: PlaceholderAlignment.baseline,
                                baseline: TextBaseline.alphabetic,
                                child: InkWell(
                                  key: const Key('login_sign_up'),
                                  onTap: _submitting
                                      ? null
                                      : () => Navigator.of(context).push(
                                          MaterialPageRoute<void>(
                                            builder: (_) => RegisterPage(
                                              controller: widget.controller,
                                            ),
                                          ),
                                        ),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    child: Text(
                                      'Sign up',
                                      style: AlmaPayText.ui(
                                        size: 15,
                                        weight: 600,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
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

/// The dark blue top of the signed-out screens: the wordmark and a ticket that
/// says what the app does, without any rate or country (those come from the
/// provider once you are signed in).
class _AuthHeader extends StatelessWidget {
  const _AuthHeader();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        22,
        MediaQuery.paddingOf(context).top + 14,
        22,
        26,
      ),
      decoration: const BoxDecoration(
        color: AlmaPayColours.ink,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(44)),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [AaminWordmark(), SizedBox(height: 18), WelcomeTickets()],
      ),
    );
  }
}
