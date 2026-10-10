import 'package:flutter/material.dart';

import '../demo_scope.dart';
import '../demo_theme.dart';

/// Sign-up (or log-in) and the email code. Any code is accepted: nothing is checked
/// or sent, because there is no backend.
class SignUpPage extends StatefulWidget {
  const SignUpPage({this.logIn = false, super.key});
  final bool logIn;

  @override
  State<SignUpPage> createState() => _SignUpPageState();
}

class _SignUpPageState extends State<SignUpPage> {
  final _name = TextEditingController(text: 'Sara Whitfield');
  final _email = TextEditingController(text: 'sara@example.com');
  final _password = TextEditingController(text: 'demo-password');
  final _code = TextEditingController();
  bool _askCode = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  void _finish() {
    final store = DemoScope.of(context);
    store.signUp(name: _name.text, emailAddress: _email.text);
    // Back to the root: the gate now shows the signed-in app.
    Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              _askCode
                  ? 'Check your email'
                  : (widget.logIn ? 'Welcome back' : 'Create your account'),
              style: DemoText.display.copyWith(fontSize: 38, height: 1),
            ),
            const SizedBox(height: 8),
            if (_askCode) ...[
              Text(
                'We would send a 6-digit code to ${_email.text}. This is a demo: type any digits.',
                style: const TextStyle(color: DemoColours.ink2),
              ),
              const SizedBox(height: 20),
              TextField(
                key: const Key('code_field'),
                controller: _code,
                keyboardType: TextInputType.number,
                autofocus: true,
                maxLength: 6,
                decoration: const InputDecoration(labelText: '6-digit code'),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              FilledButton(
                key: const Key('confirm_code'),
                onPressed: _code.text.isEmpty ? null : _finish,
                child: const Text('Continue'),
              ),
            ] else ...[
              const Text(
                'Sample details are filled in. Change them or just continue.',
                style: TextStyle(color: DemoColours.ink2),
              ),
              const SizedBox(height: 20),
              if (!widget.logIn) ...[
                TextField(
                  key: const Key('name_field'),
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Full name'),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                key: const Key('email_field'),
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('password_field'),
                controller: _password,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Password'),
              ),
              const SizedBox(height: 20),
              FilledButton(
                key: const Key('continue_sign_up'),
                onPressed: () =>
                    widget.logIn ? _finish() : setState(() => _askCode = true),
                child: Text(widget.logIn ? 'Log in' : 'Continue'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
