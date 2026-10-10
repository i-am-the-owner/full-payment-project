import 'dart:async';

import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_scope.dart';
import '../demo_theme.dart';
import '../demo_time.dart';
import '../widgets/common.dart';
import 'add_person.dart';
import 'amount.dart';
import 'pay.dart';
import 'shell.dart';
import 'track.dart';

/// Organised around people, not accounts: each shows their local time.
class HomeTab extends StatefulWidget {
  const HomeTab({super.key});

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  Timer? _clockTimer;

  @override
  void initState() {
    super.initState();
    // The two clocks tick.
    _clockTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clockTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    final now = store.nowUtc;
    final featured = store.people.firstWhere(
      (p) => p.id == 'priya',
      orElse: () => store.people.first,
    );
    final open = store.latestOpen;
    final others = store.people.where((p) => p.id != featured.id).toList();
    final d = featured.destination;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        Text(
          'Hi ${store.userName}',
          style: DemoText.display.copyWith(fontSize: 38, height: 1),
        ),
        const SizedBox(height: 14),
        // The person you send to most.
        GestureDetector(
          key: const Key('home_featured'),
          onTap: () => _send(context, featured),
          child: Container(
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
                    Avatar(featured),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '${featured.firstName}, ${featured.city}',
                        style: TextStyle(
                          color: d.onColour,
                          fontWeight: FontWeight.w700,
                          fontSize: 17,
                        ),
                      ),
                    ),
                    Icon(Icons.schedule, size: 16, color: d.onColour),
                    const SizedBox(width: 4),
                    Text(
                      localClock(now, d),
                      style: DemoText.display.copyWith(
                        fontSize: 22,
                        color: d.onColour,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Text(
                  '£1 buys',
                  style: TextStyle(color: d.onColour.withValues(alpha: .8)),
                ),
                Text(
                  '${d.symbol}${d.rateText}',
                  style: DemoText.display.copyWith(
                    fontSize: 46,
                    color: d.onColour,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (open != null) ...[
          const SizedBox(height: 12),
          Panel(
            child: Row(
              children: [
                const Icon(Icons.hourglass_top, color: DemoColours.wait),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    open.status == DemoStatus.awaitingPayment
                        ? 'Waiting for your ${gbp(open.sendPence)}'
                        : '${gbp(open.sendPence)} to ${open.person.firstName}: ${open.status.badge.toLowerCase()}',
                    key: const Key('home_open_transfer'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                FilledButton(
                  key: const Key('home_pay_now'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(96, 40),
                  ),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => open.status == DemoStatus.awaitingPayment
                          ? PayPage(transfer: open)
                          : TrackPage(transfer: open),
                    ),
                  ),
                  child: Text(
                    open.status == DemoStatus.awaitingPayment
                        ? 'Pay now'
                        : 'Track',
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 22),
        Row(
          children: [
            Expanded(
              child: Text(
                'Your people',
                overflow: TextOverflow.ellipsis,
                style: DemoText.display.copyWith(fontSize: 24),
              ),
            ),
            const Text(
              'Local time',
              style: TextStyle(color: DemoColours.ink2, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 6),
        for (final p in others)
          ListTile(
            key: Key('person_${p.id}'),
            contentPadding: EdgeInsets.zero,
            leading: Avatar(p),
            title: Text(
              p.name,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text('${p.city}, ${p.destination.country}'),
            trailing: Text(
              localClock(now, p.destination),
              style: DemoText.display.copyWith(fontSize: 22),
            ),
            onTap: () => _send(context, p),
          ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          key: const Key('home_add_someone'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const AddPersonPage()),
          ),
          icon: const Icon(Icons.add),
          label: const Text('Add someone'),
        ),
        const SizedBox(height: 12),
        TextButton(
          onPressed: () => DemoShellState.maybeOf(context)?.goTo(2),
          child: const Text('See all transfers'),
        ),
      ],
    );
  }

  void _send(BuildContext context, Person p) {
    Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => AmountPage(person: p)));
  }
}
