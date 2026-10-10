import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../../../src/shared/money.ts';

test('parses decimal strings into exact minor units', () => {
  assert.equal(parseDecimalToMinorUnits('129.24', 2), 12924n);
  assert.equal(parseDecimalToMinorUnits('100', 2), 10000n);
  assert.equal(parseDecimalToMinorUnits('0.07', 2), 7n);
  assert.equal(parseDecimalToMinorUnits('1000000.99', 2), 100000099n);
});

test('parses numbers without floating-point error', () => {
  assert.equal(parseDecimalToMinorUnits(129.24, 2), 12924n);
  assert.equal(parseDecimalToMinorUnits(0.1 + 0.2, 2), 30n);
});

test('rejects amounts with more precision than the currency allows', () => {
  assert.throws(() => parseDecimalToMinorUnits('1.234', 2), RangeError);
});

test('rejects non-decimal input', () => {
  assert.throws(() => parseDecimalToMinorUnits('12,34', 2), RangeError);
  assert.throws(() => parseDecimalToMinorUnits('abc', 2), RangeError);
});

test('formats minor units back to a decimal string', () => {
  assert.equal(formatMinorUnits(12924n, 2), '129.24');
  assert.equal(formatMinorUnits(7n, 2), '0.07');
  assert.equal(formatMinorUnits(10000n, 2), '100.00');
  assert.equal(formatMinorUnits(500n, 0), '500');
});

test('round-trips', () => {
  for (const value of ['0.01', '9999.99', '250.00', '1.50']) {
    assert.equal(formatMinorUnits(parseDecimalToMinorUnits(value, 2), 2), value);
  }
});
