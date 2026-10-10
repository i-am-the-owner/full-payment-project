import 'demo_models.dart';

/// Money in the demo is integers: pence for pounds, minor units for the rest.

/// `£1,234.50`.
String gbp(int pence) => '£${_grouped(pence)}';

/// `₹55,880.62`, `MX$4,612.00`, `GH₵2,710.50`.
String foreign(Destination d, int minor) => '${d.symbol}${_grouped(minor)}';

String _grouped(int minor) {
  final whole = (minor ~/ 100).toString();
  final frac = (minor % 100).toString().padLeft(2, '0');
  final buf = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) buf.write(',');
    buf.write(whole[i]);
  }
  return '$buf.$frac';
}

/// Our fee: £1.92 plus 0.24% (the sample fees: £3.12 on £500, £2.40 on £200).
int feeFor(int sendPence) => 192 + (sendPence * 24) ~/ 10000;

/// What the recipient gets: the amount after the fee, at the rate.
int receiveFor(Destination d, int sendPence) =>
    ((sendPence - feeFor(sendPence)) * d.rateTimes10000 + 5000) ~/ 10000;

/// Parses what the keypad typed (`500`, `12.5`, `0.`) into pence; null if empty or invalid.
int? parsePence(String typed) {
  if (typed.isEmpty || typed == '.') return null;
  final parts = typed.split('.');
  if (parts.length > 2) return null;
  final whole = int.tryParse(parts[0].isEmpty ? '0' : parts[0]);
  if (whole == null) return null;
  var frac = parts.length == 2 ? parts[1] : '';
  if (frac.length > 2) return null;
  frac = frac.padRight(2, '0');
  return whole * 100 + int.parse(frac);
}
