import 'dart:async';

import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_scope.dart';
import '../demo_theme.dart';
import '../demo_time.dart';
import '../widgets/common.dart';
import '../widgets/ticket.dart';
import 'amount.dart';
import 'pay.dart';

/// "Check your ticket": the complete ticket (route, both local times, what arrives and every cost).
class ReviewPage extends StatefulWidget {
  const ReviewPage({required this.person, required this.sendPence, super.key});
  final Person person;
  final int sendPence;

  @override
  State<ReviewPage> createState() => _ReviewPageState();
}

class _ReviewPageState extends State<ReviewPage> {
  late DateTime _expires;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _expires = DateTime.now().add(rateHold);
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String get _countdown {
    final left = _expires.difference(DateTime.now());
    if (left.isNegative) return '00:00';
    final m = left.inMinutes.toString().padLeft(2, '0');
    final s = (left.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.person;
    final d = p.destination;
    final store = DemoScope.of(context);
    final now = store.nowUtc;
    final fee = feeFor(widget.sendPence);
    final receive = receiveFor(d, widget.sendPence);
    final total = widget.sendPence;

    return Scaffold(
      appBar: AppBar(title: const Text('Check your ticket')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          children: [
            Ticket(
              destination: d,
              fromCity: 'Leicester',
              toCity: p.city,
              fromTime: ukClock(now),
              toTime: localClock(now, d),
              label: '${p.firstName} gets',
              amountMinor: receive,
            ),
            const SizedBox(height: 12),
            Panel(
              child: Column(
                children: [
                  Row(
                    children: [
                      Avatar(p, size: 36),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '${p.name}, ${p.bankLine}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 24),
                  KeyValueRow('You pay', gbp(total), bold: true),
                  KeyValueRow('Of which our fee', gbp(fee)),
                  KeyValueRow('Rate', '${d.symbol}${d.rateText}'),
                  KeyValueRow(
                    'Arrives',
                    'by ${arrivalBy(now, d)} ${d.code == 'IN' ? 'IST' : 'local time'}',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Rate held for another $_countdown',
              key: const Key('rate_countdown'),
              style: const TextStyle(color: DemoColours.ink2),
            ),
            const SizedBox(height: 14),
            FilledButton(
              key: const Key('confirm_transfer'),
              onPressed: () {
                final t = store.createTransfer(p, widget.sendPence);
                // Replace this and the amount screen so "back" returns to the tabs.
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute<void>(builder: (_) => PayPage(transfer: t)),
                  (r) => r.isFirst,
                );
              },
              child: const Text('Confirm transfer'),
            ),
          ],
        ),
      ),
    );
  }
}
