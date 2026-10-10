import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_scope.dart';
import '../demo_theme.dart';
import '../demo_time.dart';
import '../widgets/common.dart';
import 'receipt.dart';
import 'returned.dart';

/// "On its way to Priya": a journey from city to city. The big number is when it lands, in their time.
class TrackPage extends StatelessWidget {
  const TrackPage({required this.transfer, super.key});
  final DemoTransfer transfer;

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    final t = transfer;
    final p = t.person;
    final d = p.destination;
    final now = store.nowUtc;
    final received = _at(t, DemoStatus.paymentReceived);
    final converting = _at(t, DemoStatus.converting);
    final delivered = t.status == DemoStatus.delivered;
    final comingBack =
        t.status == DemoStatus.returning || t.status == DemoStatus.returned;
    final arrival = arrivalBy(t.createdAt, d);

    final steps = <_Step>[
      _Step(
        done: true,
        title: 'Leicester: ticket booked',
        detail: '${ukClock(t.createdAt)} your time',
      ),
      _Step(
        done: received != null,
        title: 'Your ${gbp(t.totalPence)} reached our partner',
        detail: received == null
            ? 'Waiting for your payment'
            : '${ukClock(received)} your time',
      ),
      _Step(
        done:
            delivered ||
            (converting != null &&
                comingBack == false &&
                t.status != DemoStatus.converting),
        active:
            t.status == DemoStatus.converting ||
            t.status == DemoStatus.paymentReceived,
        title: 'Changing to ${_currencyWord(d)}, sending to ${p.bank}',
        detail: converting != null || received != null
            ? (delivered ? 'Done' : 'Now')
            : 'Next',
      ),
      _Step(
        done: delivered,
        title: '${p.city}: in ${p.firstName}\'s account',
        detail: delivered
            ? '${localClock(_at(t, DemoStatus.delivered) ?? now, d)} their time'
            : "We'll tell you both",
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(delivered ? 'Delivered' : 'Tracking')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          children: [
            Text(
              delivered
                  ? '${p.firstName} has it'
                  : (comingBack
                        ? 'Coming back to you'
                        : 'On its way to ${p.firstName}'),
              key: const Key('track_title'),
              style: DemoText.display.copyWith(fontSize: 36, height: 1),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: ticketBand(t.status),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    delivered
                        ? 'Arrived in ${p.city}'
                        : 'Arrives in ${p.city} by',
                    style: TextStyle(color: d.onColour.withValues(alpha: .85)),
                  ),
                  Text(
                    arrival,
                    style: DemoText.display.copyWith(
                      fontSize: 64,
                      color: d.onColour,
                      height: 1,
                    ),
                  ),
                  Text(
                    "That's ${arrivalByUk(t.createdAt)} in Leicester",
                    style: TextStyle(color: d.onColour.withValues(alpha: .85)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Panel(
              child: Column(
                children: [
                  for (var i = 0; i < steps.length; i++)
                    _StepTile(
                      step: steps[i],
                      last: i == steps.length - 1,
                      colour: ticketBand(t.status),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Status: ${t.status.badge}',
              key: const Key('track_status'),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 14),
            if (delivered)
              FilledButton(
                key: const Key('view_receipt'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ReceiptPage(transfer: t),
                  ),
                ),
                child: const Text('View receipt'),
              ),
            if (comingBack)
              FilledButton(
                key: const Key('view_returned'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ReturnedPage(transfer: t),
                  ),
                ),
                child: const Text('See where your money is'),
              ),
            if (!delivered &&
                !comingBack &&
                t.status != DemoStatus.awaitingPayment) ...[
              OutlinedButton.icon(
                onPressed: () =>
                    Navigator.of(context).popUntil((r) => r.isFirst),
                icon: const Icon(Icons.share_outlined),
                label: Text('Send ${p.firstName} the tracking link'),
              ),
              const SizedBox(height: 18),
              const Divider(),
              const Text(
                'Demo only',
                style: TextStyle(color: DemoColours.ink2, fontSize: 12),
              ),
              TextButton(
                key: const Key('demo_reject'),
                onPressed: () => store.simulateBankRejection(t),
                child: Text("Make ${p.firstName}'s bank reject this payment"),
              ),
            ],
          ],
        ),
      ),
    );
  }

  static DateTime? deliveredAt(DemoTransfer t) => _at(t, DemoStatus.delivered);

  static DateTime? _at(DemoTransfer t, DemoStatus s) {
    for (final e in t.events) {
      if (e.status == s) return e.at;
    }
    return null;
  }

  static String _currencyWord(Destination d) => switch (d.currency) {
    'INR' => 'rupees',
    'MXN' => 'pesos',
    'GHS' => 'cedis',
    _ => d.currency,
  };

  static String arrivalByUk(DateTime createdAt) =>
      ukClock(createdAt.add(const Duration(hours: 2)));
}

class _Step {
  const _Step({
    required this.done,
    required this.title,
    required this.detail,
    this.active = false,
  });
  final bool done;
  final bool active;
  final String title;
  final String detail;
}

class _StepTile extends StatelessWidget {
  const _StepTile({
    required this.step,
    required this.last,
    required this.colour,
  });
  final _Step step;
  final bool last;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    final on = step.done || step.active;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: step.done
                      ? DemoColours.ok
                      : (step.active ? colour : DemoColours.fog),
                  border: Border.all(
                    color: on ? Colors.transparent : DemoColours.line,
                  ),
                ),
                child: step.done
                    ? const Icon(Icons.check, size: 14, color: Colors.white)
                    : null,
              ),
              if (!last)
                Expanded(
                  child: Container(
                    width: 2,
                    color: step.done ? DemoColours.ok : DemoColours.line,
                  ),
                ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    step.title,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: on ? DemoColours.ink : DemoColours.ink2,
                    ),
                  ),
                  Text(
                    step.detail,
                    style: const TextStyle(
                      color: DemoColours.ink2,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
