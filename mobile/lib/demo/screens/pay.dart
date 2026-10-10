import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_scope.dart';
import '../demo_store.dart';
import '../demo_theme.dart';
import '../widgets/common.dart';
import 'track.dart';

/// "Pay for your ticket": the reference gets its own black ticket, because it is the one detail that must be exact.
class PayPage extends StatelessWidget {
  const PayPage({required this.transfer, super.key});
  final DemoTransfer transfer;

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Pay for your ticket')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          children: [
            Text(
              'Send ${gbp(transfer.totalPence)} from your bank',
              style: DemoText.display.copyWith(fontSize: 32, height: 1),
            ),
            const SizedBox(height: 6),
            const Text(
              'Pay our licensed partner from your banking app. Use the reference exactly.',
              style: TextStyle(color: DemoColours.ink2),
            ),
            const SizedBox(height: 14),
            const Panel(
              child: Column(
                children: [
                  KeyValueRow('Pay to', partnerName),
                  KeyValueRow('Sort code', partnerSortCode),
                  KeyValueRow('Account', partnerAccount),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: DemoColours.ink,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Reference',
                    style: TextStyle(color: Colors.white70),
                  ),
                  Text(
                    transfer.reference,
                    key: const Key('pay_reference'),
                    style: DemoText.display.copyWith(
                      fontSize: 44,
                      color: Colors.white,
                      height: 1.1,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    "Without it we can't match your payment",
                    style: TextStyle(color: Colors.white70),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    key: const Key('copy_reference'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Colors.white54),
                      minimumSize: const Size(0, 44),
                    ),
                    onPressed: () async {
                      await Clipboard.setData(
                        ClipboardData(text: transfer.reference),
                      );
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Reference copied')),
                        );
                      }
                    },
                    icon: const Icon(Icons.copy, size: 18),
                    label: const Text('Copy'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Row(
              children: [
                Icon(Icons.shield_outlined, color: DemoColours.ok),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'The money goes to our partner, not to AaminPay.',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Demo: there is no real bank and no real money. Tap "I\'ve paid" and watch it travel.',
              style: TextStyle(color: DemoColours.ink2),
            ),
            const SizedBox(height: 18),
            FilledButton(
              key: const Key('i_have_paid'),
              onPressed: () {
                store.markPaid(transfer);
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute<void>(
                    builder: (_) => TrackPage(transfer: transfer),
                  ),
                );
              },
              child: const Text("I've paid"),
            ),
          ],
        ),
      ),
    );
  }
}
