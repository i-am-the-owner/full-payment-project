/// Turns what a customer types into the international form the backend wants
/// (`+447700900123`). A UK number needs no country code: `07700 900123` and
/// `7700900123` both become `+447700900123`. A number that already starts with
/// `+` or `00` is taken as international and left alone.
String normalisePhone(String input, {String dialCode = '+44'}) {
  final typed = input.replaceAll(RegExp(r'[\s().-]'), '');
  if (typed.isEmpty) return '';
  if (typed.startsWith('+')) return typed;
  if (typed.startsWith('00')) return '+${typed.substring(2)}';
  final national = typed.startsWith('0') ? typed.substring(1) : typed;
  return '$dialCode$national';
}

/// What to show in the field for a saved number: the part after `+44`, as the
/// customer would type it. Other countries' numbers are shown in full.
String phoneForField(String saved, {String dialCode = '+44'}) =>
    saved.startsWith(dialCode) ? saved.substring(dialCode.length) : saved;

final _e164 = RegExp(r'^\+[1-9]\d{6,14}$');

/// True when [input] becomes a plausible international number.
bool isValidPhone(String input, {String dialCode = '+44'}) =>
    _e164.hasMatch(normalisePhone(input, dialCode: dialCode));
