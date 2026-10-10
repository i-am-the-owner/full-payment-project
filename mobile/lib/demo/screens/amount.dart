import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_scope.dart';
import '../demo_store.dart';
import '../demo_theme.dart';
import '../demo_time.dart';
import '../widgets/common.dart';
import 'review.dart';

/// "Send to Priya": the ticket fills in as you type. Arrival is given in the recipient's own time.
class AmountPage extends StatefulWidget {
  const AmountPage({required this.person, super.key});
  final Person person;

  @override
  State<AmountPage> createState() => _AmountPageState();
}

class _AmountPageState extends State<AmountPage> {
  String _typed = '500';

  int? get _pence => parsePence(_typed);

  void _press(String key) {
    setState(() {
      if (key == '<') {
        _typed = _typed.isEmpty ? '' : _typed.substring(0, _typed.length - 1);
        return;
      }
      if (key == '.') {
        if (_typed.contains('.')) return;
        _typed = _typed.isEmpty ? '0.' : '$_typed.';
        return;
      }
      final next = _typed == '0' ? key : _typed + key;
      final dot = next.indexOf('.');
      if (dot >= 0 && next.length - dot > 3) return; // two decimals at most
      if (dot < 0 && next.length > 5) return;
      _typed = next;
    });
  }

  String? get _problem {
    final p = _pence;
    if (p == null) return null;
    if (p < minSendPence) {
      return 'The least you can send is ${gbp(minSendPence)}.';
    }
    if (p > maxSendPence) {
      return 'The most you can send at once is ${gbp(maxSendPence)}.';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final person = widget.person;
    final d = person.destination;
    final pence = _pence;
    final valid = pence != null && _problem == null;
    final now = DemoScope.of(context).nowUtc;
    final fee = pence == null ? 0 : feeFor(pence);
    final receive = valid ? receiveFor(d, pence) : 0;

    return Scaffold(
      appBar: AppBar(title: Text('Send to ${person.firstName}')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: d.colour,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'You send',
                          style: TextStyle(
                            color: d.onColour.withValues(alpha: .8),
                          ),
                        ),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _typed.isEmpty ? '£0' : '£$_typed',
                                key: const Key('amount_typed'),
                                style: DemoText.display.copyWith(
                                  fontSize: 52,
                                  color: d.onColour,
                                  height: 1,
                                ),
                              ),
                            ),
                            Text(
                              'GBP',
                              style: DemoText.display.copyWith(
                                fontSize: 22,
                                color: d.onColour,
                              ),
                            ),
                          ],
                        ),
                        const Divider(height: 22),
                        Text(
                          '${person.firstName} gets',
                          style: TextStyle(
                            color: d.onColour.withValues(alpha: .8),
                          ),
                        ),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                valid ? foreign(d, receive) : '${d.symbol}0.00',
                                key: const Key('amount_receive'),
                                style: DemoText.display.copyWith(
                                  fontSize: 40,
                                  color: d.onColour,
                                  height: 1,
                                ),
                              ),
                            ),
                            Text(
                              d.currency,
                              style: DemoText.display.copyWith(
                                fontSize: 22,
                                color: d.onColour,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Panel(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Column(
                      children: [
                        KeyValueRow('Our fee', valid ? gbp(fee) : '–'),
                        KeyValueRow(
                          'Rate, held 30 min',
                          '£1 = ${d.symbol}${d.rateText}',
                        ),
                        KeyValueRow(
                          'Arrives in ${person.city}',
                          valid ? 'by ${arrivalBy(now, d)} their time' : '–',
                        ),
                      ],
                    ),
                  ),
                  if (_problem != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        _problem!,
                        key: const Key('amount_problem'),
                        style: const TextStyle(color: DemoColours.bad),
                      ),
                    ),
                ],
              ),
            ),
            _Keypad(onKey: _press),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: FilledButton(
                key: const Key('amount_continue'),
                onPressed: valid
                    ? () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) =>
                              ReviewPage(person: person, sendPence: pence),
                        ),
                      )
                    : null,
                child: const Text('Continue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Keypad extends StatelessWidget {
  const _Keypad({required this.onKey});
  final void Function(String) onKey;

  @override
  Widget build(BuildContext context) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        childAspectRatio: 2.6,
        children: [
          for (final k in keys)
            InkWell(
              key: Key('key_$k'),
              borderRadius: BorderRadius.circular(12),
              onTap: () => onKey(k),
              child: Center(
                child: k == '<'
                    ? const Icon(Icons.backspace_outlined)
                    : Text(k, style: DemoText.display.copyWith(fontSize: 28)),
              ),
            ),
        ],
      ),
    );
  }
}

/// Used by the review screen to hold the rate for 30 minutes.
Duration get rateHold => const Duration(minutes: 30);
