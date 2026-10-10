import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../domain/onboarding_models.dart';
import '../domain/phone_number.dart';
import 'onboarding_controller.dart';

/// The profile step: name, date of birth, country and phone number.
class ProfileFormView extends StatefulWidget {
  const ProfileFormView({required this.controller, super.key});

  final OnboardingController controller;

  @override
  State<ProfileFormView> createState() => _ProfileFormViewState();
}

class _ProfileFormViewState extends State<ProfileFormView> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _firstName;
  late final TextEditingController _lastName;
  late final TextEditingController _day;
  late final TextEditingController _month;
  late final TextEditingController _year;
  late final TextEditingController _phone;
  String? _country;

  @override
  void initState() {
    super.initState();
    final form = widget.controller.profileForm;
    final saved = form?.values ?? const <String, String>{};
    final born = (saved['dateOfBirth'] ?? '').split('-');
    _firstName = TextEditingController(text: saved['firstName'] ?? '');
    _lastName = TextEditingController(text: saved['lastName'] ?? '');
    _year = TextEditingController(text: born.length == 3 ? born[0] : '');
    _month = TextEditingController(text: born.length == 3 ? born[1] : '');
    _day = TextEditingController(text: born.length == 3 ? born[2] : '');
    _phone = TextEditingController(text: phoneForField(saved['phone'] ?? ''));
    final countries = form?.supportedCountries ?? const <String>[];
    final savedCountry = saved['countryOfResidence'];
    _country = countries.contains(savedCountry)
        ? savedCountry
        : (countries.length == 1 ? countries.single : null);
  }

  @override
  void dispose() {
    for (final c in [_firstName, _lastName, _day, _month, _year, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The date as `YYYY-MM-DD`, or null if it is not a real date.
  String? _isoDate() {
    final day = int.tryParse(_day.text.trim());
    final month = int.tryParse(_month.text.trim());
    final year = int.tryParse(_year.text.trim());
    if (day == null || month == null || year == null || year < 1900) {
      return null;
    }
    final date = DateTime.utc(year, month, day);
    if (date.year != year || date.month != month || date.day != day) {
      return null;
    }
    String two(int n) => n.toString().padLeft(2, '0');
    return '$year-${two(month)}-${two(day)}';
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    await widget.controller.saveProfile(
      CustomerProfile(
        firstName: _firstName.text.trim(),
        lastName: _lastName.text.trim(),
        dateOfBirth: _isoDate()!,
        countryOfResidence: _country!,
        phone: normalisePhone(_phone.text),
      ),
    );
  }

  String? _required(String? value, String message) =>
      (value == null || value.trim().isEmpty) ? message : null;

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final serverErrors = controller.fieldErrors;
    final countries =
        controller.profileForm?.supportedCountries ?? const <String>[];
    final textTheme = Theme.of(context).textTheme;

    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(
              'TELL US ABOUT YOU',
              style: AlmaPayText.display.copyWith(fontSize: 38, height: .95),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Use your name exactly as it appears on your passport or driving '
            'licence. We will check it when you verify your identity.',
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const Key('profile_first_name'),
            controller: _firstName,
            decoration: InputDecoration(
              labelText: 'First name',
              errorText: serverErrors['firstName'],
            ),
            textCapitalization: TextCapitalization.words,
            autofillHints: const [AutofillHints.givenName],
            textInputAction: TextInputAction.next,
            validator: (v) => _required(v, 'Enter your first name'),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('profile_last_name'),
            controller: _lastName,
            decoration: InputDecoration(
              labelText: 'Last name',
              errorText: serverErrors['lastName'],
            ),
            textCapitalization: TextCapitalization.words,
            autofillHints: const [AutofillHints.familyName],
            textInputAction: TextInputAction.next,
            validator: (v) => _required(v, 'Enter your last name'),
          ),
          const SizedBox(height: 20),
          Semantics(
            header: true,
            child: Text('Date of birth', style: textTheme.titleMedium),
          ),
          const SizedBox(height: 4),
          const Text('For example, 27 3 1990'),
          const SizedBox(height: 8),
          FormField<String>(
            validator: (_) =>
                _isoDate() == null ? 'Enter your date of birth' : null,
            builder: (field) {
              final error = field.errorText ?? serverErrors['dateOfBirth'];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _DatePart(
                        fieldKey: const Key('profile_dob_day'),
                        controller: _day,
                        label: 'Day',
                        length: 2,
                        flex: 2,
                      ),
                      const SizedBox(width: 12),
                      _DatePart(
                        fieldKey: const Key('profile_dob_month'),
                        controller: _month,
                        label: 'Month',
                        length: 2,
                        flex: 2,
                      ),
                      const SizedBox(width: 12),
                      _DatePart(
                        fieldKey: const Key('profile_dob_year'),
                        controller: _year,
                        label: 'Year',
                        length: 4,
                        flex: 3,
                      ),
                    ],
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Semantics(
                        liveRegion: true,
                        child: Text(
                          error,
                          style: textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
          const SizedBox(height: 20),
          DropdownButtonFormField<String>(
            key: const Key('profile_country'),
            initialValue: _country,
            decoration: InputDecoration(
              labelText: 'Country you live in',
              errorText: serverErrors['countryOfResidence'],
              helperText: countries.isEmpty
                  ? null
                  : 'AaminPay is only available in the countries listed',
            ),
            items: [
              for (final code in countries)
                DropdownMenuItem(value: code, child: Text(code)),
            ],
            onChanged: (value) => setState(() => _country = value),
            validator: (v) =>
                v == null ? 'Choose the country you live in' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('profile_phone'),
            controller: _phone,
            decoration: InputDecoration(
              labelText: 'Mobile phone number',
              helperText: 'Just your number, for example 07700 900123',
              prefixText: '+44  ',
              errorText: serverErrors['phone'],
            ),
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumber],
            validator: (v) =>
                isValidPhone(v ?? '') ? null : 'Enter your mobile number',
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const Key('profile_submit'),
            onPressed: controller.busy ? null : _submit,
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }
}

class _DatePart extends StatelessWidget {
  const _DatePart({
    required this.fieldKey,
    required this.controller,
    required this.label,
    required this.length,
    required this.flex,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final int length;
  final int flex;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      flex: flex,
      child: TextField(
        key: fieldKey,
        controller: controller,
        decoration: InputDecoration(labelText: label),
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.next,
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
          LengthLimitingTextInputFormatter(length),
        ],
      ),
    );
  }
}
