import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';
import 'auth_controller.dart';

class RegisterPage extends StatefulWidget {
  const RegisterPage({required this.controller, super.key});

  final AuthController controller;

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _submitting = true);
    final error = await widget.controller.register(
      email: _email.text.trim(),
      password: _password.text,
    );
    if (!mounted) {
      return;
    }
    if (error != null) {
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
      return;
    }
    // Signed up: go straight in rather than back to the log in screen.
    final signedIn = await widget.controller.login(
      email: _email.text.trim(),
      password: _password.text,
    );
    if (!mounted) {
      return;
    }
    setState(() => _submitting = false);
    if (signedIn) {
      // The app now shows the signed-in screens; close this page.
      Navigator.of(context).popUntil((route) => route.isFirst);
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    Navigator.of(context).pop();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          widget.controller.lastError ??
              'Account created. Check your email for a verification link, '
                  'then log in.',
        ),
      ),
    );
  }

  bool _showPassword = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign up')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(22, 8, 22, 24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'CREATE YOUR ACCOUNT',
                  style: AlmaPayText.display.copyWith(fontSize: 40),
                ),
                const SizedBox(height: 8),
                Text(
                  'We will email you a link to verify your address.',
                  style: AlmaPayText.ui(size: 16, color: context.palette.muted),
                ),
                const SizedBox(height: 20),
                TextFormField(
                  key: const Key('register_email'),
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'Email'),
                  keyboardType: TextInputType.emailAddress,
                  validator: (value) => (value == null || !value.contains('@'))
                      ? 'Enter a valid email'
                      : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  key: const Key('register_password'),
                  controller: _password,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    helperText: 'At least 12 characters',
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
                  autofillHints: const [AutofillHints.newPassword],
                  validator: (value) => (value == null || value.length < 12)
                      ? 'Use at least 12 characters'
                      : null,
                ),
                const SizedBox(height: 28),
                FilledButton(
                  key: const Key('register_submit'),
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Theme.of(context).colorScheme.onPrimary,
                          ),
                        )
                      : const Text('Create account'),
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: Text.rich(
                      TextSpan(
                        text: 'Already have an account? ',
                        style: AlmaPayText.ui(
                          size: 15,
                          color: context.palette.muted,
                        ),
                        children: [
                          TextSpan(
                            text: 'Log in',
                            style: AlmaPayText.ui(size: 15, weight: 600),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
