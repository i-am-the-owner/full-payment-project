import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_scope.dart';
import '../demo_theme.dart';
import '../widgets/common.dart';
import '../widgets/ticket.dart';
import 'pay.dart';
import 'receipt.dart';
import 'returned.dart';
import 'track.dart';

/// A stack of tickets. Colour tells the destination at a glance; the badge tells the status.
class TransfersTab extends StatelessWidget {
  const TransfersTab({super.key});

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        const ScreenTitle('Transfers'),
        for (final t in store.transfers)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: GestureDetector(
              key: Key('transfer_${t.reference}'),
              onTap: () => Navigator.of(context)
                  .push(MaterialPageRoute<void>(builder: (_) => _pageFor(t))),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 4),
                    child: Text(
                      '${t.dateLabel} · ${t.person.name}',
                      style: const TextStyle(
                        color: DemoColours.ink2,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Ticket(
                    destination: t.person.destination,
                    fromCity: 'GBP → ${t.person.destination.currency}',
                    toCity: t.person.city,
                    label:
                        t.status == DemoStatus.returned ||
                            t.status == DemoStatus.returning
                        ? 'Was going to ${t.person.firstName}'
                        : '${t.person.firstName} gets',
                    amountMinor: t.receiveMinor,
                    band: ticketBand(t.status),
                    badge: t.status.badge,
                    badgeColours: badgeColours(t.status),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _pageFor(DemoTransfer t) => switch (t.status) {
    DemoStatus.awaitingPayment => PayPage(transfer: t),
    DemoStatus.delivered => ReceiptPage(transfer: t),
    DemoStatus.returning || DemoStatus.returned => ReturnedPage(transfer: t),
    _ => TrackPage(transfer: t),
  };
}
