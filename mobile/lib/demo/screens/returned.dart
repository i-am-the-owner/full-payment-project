import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_theme.dart';
import '../widgets/common.dart';
import 'amount.dart';

/// "Money returned": the route reverses, so the customer understands at once.
class ReturnedPage extends StatelessWidget {
  const ReturnedPage({required this.transfer, super.key});
  final DemoTransfer transfer;

  @override
  Widget build(BuildContext context) {
    final t = transfer;
    final p = t.person;
    final d = p.destination;
    return Scaffold(
      appBar: AppBar(title: Text('Transfer to ${p.firstName}')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          children: [
            // The route literally reverses: the currency we are sending back to, and from.
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: d.colour,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        d.currency,
                        style: DemoText.display.copyWith(
                          fontSize: 26,
                          color: d.onColour,
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        child: Icon(Icons.flight_land, color: d.onColour),
                      ),
                      Text(
                        'GBP',
                        style: DemoText.display.copyWith(
                          fontSize: 26,
                          color: d.onColour,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Coming back to you',
                    style: TextStyle(color: d.onColour.withValues(alpha: .85)),
                  ),
                  Text(
                    gbp(t.totalPence),
                    key: const Key('returned_amount'),
                    style: DemoText.display.copyWith(
                      fontSize: 54,
                      color: d.onColour,
                      height: 1,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'The ticket is on its way back',
              key: const Key('returned_title'),
              style: DemoText.display.copyWith(fontSize: 28, height: 1.05),
            ),
            const SizedBox(height: 8),
            Text(
              '${t.rejectedReason ?? "${p.firstName}'s bank could not take the payment."} Our partner is returning your money.',
              style: const TextStyle(fontSize: 15),
            ),
            const SizedBox(height: 14),
            const Panel(
              child: Column(
                children: [
                  KeyValueRow('Back to', 'Your bank ending 2207'),
                  KeyValueRow('Expected', 'Within 3 working days'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('fix_and_resend'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => AmountPage(person: p)),
              ),
              child: const Text('Fix details and send again'),
            ),
          ],
        ),
      ),
    );
  }
}
