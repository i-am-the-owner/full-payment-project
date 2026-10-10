import 'package:almapay/features/onboarding/domain/phone_number.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a UK number needs no country code', () {
    expect(normalisePhone('07700 900123'), '+447700900123');
    expect(normalisePhone('7700900123'), '+447700900123');
    expect(normalisePhone('(07700) 900-123'), '+447700900123');
  });

  test('an international number is left alone', () {
    expect(normalisePhone('+33 6 12 34 56 78'), '+33612345678');
    expect(normalisePhone('0033612345678'), '+33612345678');
    expect(normalisePhone('+447700900123'), '+447700900123');
  });

  test('the saved number is shown without +44', () {
    expect(phoneForField('+447700900123'), '7700900123');
    expect(phoneForField('+33612345678'), '+33612345678');
    expect(phoneForField(''), '');
  });

  test('only plausible numbers are accepted', () {
    expect(isValidPhone('07700 900123'), isTrue);
    expect(isValidPhone(''), isFalse);
    expect(isValidPhone('0770'), isFalse);
    expect(isValidPhone('abc'), isFalse);
  });
}
