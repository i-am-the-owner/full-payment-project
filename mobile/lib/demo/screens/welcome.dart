import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_theme.dart';
import '../widgets/common.dart';
import '../widgets/ticket.dart';
import 'sign_up.dart';

/// First open: the idea in one screen, with fanned tickets.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, box) {
            return SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: box.maxHeight),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const AaminMark(size: 36),
                          const SizedBox(width: 10),
                          Text(
                            'aaminpay',
                            style: DemoText.display.copyWith(
                              fontSize: 28,
                              color: DemoColours.ink,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        height: 250,
                        child: Stack(
                          children: [
                            _fan(ghana, 'Accra', 271050, -0.07, 0),
                            _fan(mexico, 'Guadalajara', 461200, 0.03, 36),
                            _fan(
                              india,
                              'Bengaluru',
                              5588062,
                              -0.02,
                              72,
                              badge: 'Delivered',
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'From here,\nto home.',
                        style: DemoText.display.copyWith(
                          fontSize: 52,
                          height: 0.95,
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'See the exact price before you pay. Follow your money to the door.',
                        style: TextStyle(fontSize: 16, color: DemoColours.ink2),
                      ),
                      const SizedBox(height: 24),
                      FilledButton(
                        key: const Key('create_account'),
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const SignUpPage(),
                          ),
                        ),
                        child: const Text('Create account'),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton(
                        key: const Key('log_in'),
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const SignUpPage(logIn: true),
                          ),
                        ),
                        child: const Text('Log in'),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _fan(
    Destination d,
    String city,
    int minor,
    double angle,
    double top, {
    String? badge,
  }) {
    return Positioned(
      top: top,
      left: 0,
      right: 0,
      child: Transform.rotate(
        angle: angle,
        child: Ticket(
          destination: d,
          fromCity: 'Leicester',
          toCity: city,
          label: 'Gets',
          amountMinor: minor,
          band: badge == null ? null : DemoColours.paid,
          badge: badge,
          badgeColours: badge == null
              ? null
              : (DemoColours.okSoft, DemoColours.ok),
        ),
      ),
    );
  }
}
