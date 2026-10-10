import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_scope.dart';
import '../demo_theme.dart';
import 'amount.dart';

/// Adds a recipient. Only the last four digits of the account number are kept.
class AddPersonPage extends StatefulWidget {
  const AddPersonPage({super.key});

  @override
  State<AddPersonPage> createState() => _AddPersonPageState();
}

class _AddPersonPageState extends State<AddPersonPage> {
  final _name = TextEditingController();
  final _city = TextEditingController();
  final _bank = TextEditingController();
  final _account = TextEditingController();
  Destination _destination = india;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _bank.dispose();
    _account.dispose();
    super.dispose();
  }

  void _save({required bool thenSend}) {
    final digits = _account.text.replaceAll(RegExp(r'\D'), '');
    if (_name.text.trim().length < 2) {
      setState(() => _error = "Enter the person's full name.");
      return;
    }
    if (digits.length < 6) {
      setState(() => _error = 'Enter the account number (at least 6 digits).');
      return;
    }
    final person = DemoScope.of(context).addPerson(
      name: _name.text,
      city: _city.text,
      destination: _destination,
      bank: _bank.text,
      accountNumber: _account.text,
    );
    final nav = Navigator.of(context);
    if (thenSend) {
      nav.pushReplacement(
        MaterialPageRoute<void>(builder: (_) => AmountPage(person: person)),
      );
    } else {
      nav.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Add someone',
              style: DemoText.display.copyWith(fontSize: 36, height: 1),
            ),
            const SizedBox(height: 6),
            const Text(
              'The destination sets the currency and the colour. Only the last four digits of the account number are kept.',
              style: TextStyle(color: DemoColours.ink2),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                for (final d in destinations)
                  ChoiceChip(
                    key: Key('dest_${d.code}'),
                    selected: _destination == d,
                    selectedColor: d.colour,
                    labelStyle: TextStyle(
                      color: _destination == d ? d.onColour : DemoColours.ink,
                      fontWeight: FontWeight.w600,
                    ),
                    label: Text('${d.country} · ${d.currency}'),
                    onSelected: (_) => setState(() => _destination = d),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              key: const Key('person_name'),
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Full name'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('person_city'),
              controller: _city,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'City'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('person_bank'),
              controller: _bank,
              decoration: const InputDecoration(labelText: 'Bank'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('person_account'),
              controller: _account,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Account number'),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  _error!,
                  key: const Key('person_error'),
                  style: const TextStyle(color: DemoColours.bad),
                ),
              ),
            const SizedBox(height: 18),
            FilledButton(
              key: const Key('person_save_send'),
              onPressed: () => _save(thenSend: true),
              child: const Text('Save and send money'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              key: const Key('person_save'),
              onPressed: () => _save(thenSend: false),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}
