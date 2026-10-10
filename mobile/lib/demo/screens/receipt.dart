import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_theme.dart';
import '../demo_time.dart';
import '../widgets/common.dart';
import '../widgets/ticket.dart';
import 'amount.dart';
import 'track.dart';

/// The same ticket, stamped on delivery. Easy to screenshot and share as proof.
class ReceiptPage extends StatelessWidget {
  const ReceiptPage({required this.transfer, super.key});
  final DemoTransfer transfer;

  @override
  Widget build(BuildContext context) {
    final t = transfer;
    final p = t.person;
    final d = p.destination;
    final delivered = TrackPage.deliveredAt(t) ?? t.createdAt;
    return Scaffold(
      appBar: AppBar(title: const Text('Receipt')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          children: [
            Ticket(
              destination: d,
              fromCity: 'Leicester',
              toCity: p.city,
              label: '${p.firstName} got',
              amountMinor: t.receiveMinor,
              band: DemoColours.paid,
              stamp: 'Delivered ${dayMonth(delivered)}',
            ),
            const SizedBox(height: 12),
            Panel(
              child: Column(
                children: [
                  KeyValueRow('To', '${p.name}, ${p.bankLine}'),
                  KeyValueRow('You paid', gbp(t.totalPence), bold: true),
                  KeyValueRow('Of which our fee', gbp(t.feePence)),
                  KeyValueRow('Rate', '${d.symbol}${d.rateText}'),
                  KeyValueRow('Reference', t.reference),
                ],
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Paid out by Example Partner Ltd, a licensed payment institution. (Sample data: this is a demo and no money moved.)',
              style: TextStyle(color: DemoColours.ink2, fontSize: 13),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('send_again'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => AmountPage(person: p)),
              ),
              child: Text('Send to ${p.firstName} again'),
            ),
          ],
        ),
      ),
    );
  }
}
