import 'package:flutter/material.dart';

import '../demo_scope.dart';
import '../demo_theme.dart';
import '../demo_time.dart';
import '../widgets/common.dart';
import 'add_person.dart';
import 'amount.dart';

/// Saved recipients, with their city and local time, so customers don't send at 3am by habit.
class PeopleTab extends StatefulWidget {
  const PeopleTab({super.key});

  @override
  State<PeopleTab> createState() => _PeopleTabState();
}

class _PeopleTabState extends State<PeopleTab> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    final now = store.nowUtc;
    final q = _query.trim().toLowerCase();
    final people = store.people.where((p) {
      return q.isEmpty ||
          p.name.toLowerCase().contains(q) ||
          p.city.toLowerCase().contains(q) ||
          p.bank.toLowerCase().contains(q);
    }).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        const ScreenTitle('Your people'),
        TextField(
          key: const Key('people_search'),
          onChanged: (v) => setState(() => _query = v),
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Name, city or bank',
          ),
        ),
        const SizedBox(height: 8),
        if (people.isEmpty)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Text('Nobody matches that.'),
          ),
        for (final p in people)
          Card(
            elevation: 0,
            margin: const EdgeInsets.symmetric(vertical: 5),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: const BorderSide(color: DemoColours.line),
            ),
            child: ListTile(
              key: Key('people_${p.id}'),
              leading: Avatar(p),
              title: Text(
                p.name,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text('${p.city}, ${p.bankLine}'),
              trailing: Text(
                localClock(now, p.destination),
                style: DemoText.display.copyWith(fontSize: 22),
              ),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => AmountPage(person: p)),
              ),
            ),
          ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const Key('people_add'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const AddPersonPage()),
          ),
          icon: const Icon(Icons.add),
          label: const Text('Add someone'),
        ),
      ],
    );
  }
}
