import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyDisplayName,
  iso4217MinorUnits,
} from '../../../../src/infrastructure/providers/iso-4217.ts';

test('minor units follow ISO 4217', () => {
  assert.equal(iso4217MinorUnits('GBP'), 2);
  assert.equal(iso4217MinorUnits('eur'), 2);
  assert.equal(iso4217MinorUnits('JPY'), 0);
  assert.equal(iso4217MinorUnits('KRW'), 0);
  assert.equal(iso4217MinorUnits('KWD'), 3);
  assert.equal(iso4217MinorUnits('CLF'), 4);
  assert.throws(() => iso4217MinorUnits('pounds'), /Not an ISO 4217/);
});

test('display names', () => {
  assert.equal(currencyDisplayName('GBP'), 'British Pound');
});
