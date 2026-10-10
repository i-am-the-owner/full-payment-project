import 'package:flutter/material.dart';

import '../demo_money.dart';
import '../demo_scope.dart';
import '../demo_store.dart';
import '../demo_theme.dart';
import '../widgets/common.dart';

/// "You": profile, limits, security and sign out.
class AccountTab extends StatelessWidget {
  const AccountTab({super.key});

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        const ScreenTitle('You'),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                store.userName,
                key: const Key('account_name'),
                style: DemoText.display.copyWith(fontSize: 30),
              ),
              Text(
                store.email,
                style: const TextStyle(color: DemoColours.ink2),
              ),
              const SizedBox(height: 10),
              const Row(
                children: [
                  Icon(Icons.verified_user, color: DemoColours.ok, size: 20),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Identity checked by our licensed partner (sample)',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Panel(
          child: Column(
            children: [
              KeyValueRow('Most you can send at once', gbp(maxSendPence)),
              const KeyValueRow('Sending from', 'Leicester, UK'),
              const KeyValueRow('Two-step sign-in', 'Off (demo)'),
              KeyValueRow('Your people', '${store.people.length}'),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const Panel(
          child: Text(
            'AaminPay does not hold your money. You pay our licensed partner directly, and they pay out.',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(height: 18),
        OutlinedButton(
          key: const Key('reset_demo'),
          onPressed: store.reset,
          child: const Text('Reset demo'),
        ),
        const SizedBox(height: 10),
        FilledButton(
          key: const Key('sign_out'),
          onPressed: store.signOut,
          child: const Text('Sign out'),
        ),
      ],
    );
  }
}
