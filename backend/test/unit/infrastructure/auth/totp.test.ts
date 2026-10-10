import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  totpCounter,
  totpUri,
  verifyTotp,
} from '../../../../src/infrastructure/auth/totp.ts';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('matches the RFC 6238 SHA-1 test vectors (last six digits)', () => {
  for (const [seconds, code] of [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ] as const) {
    assert.equal(totpCode(RFC_SECRET, totpCounter(new Date(seconds * 1000))), code);
  }
});

test('base32 round-trips and ignores case', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.throws(() => base32Decode('not base32!'), /Not a base32 string/);
  assert.equal(base32Decode('gezdgnbvgy3tqojqgezdgnbvgy3tqojq').toString(), '12345678901234567890');
});

test('a code is accepted for the current step and one either side, and nothing else', () => {
  const now = new Date(1111111111 * 1000);
  const counter = totpCounter(now);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter), now), counter);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter - 1), now), counter - 1);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter + 1), now), counter + 1);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter - 2), now), null);
  assert.equal(verifyTotp(RFC_SECRET, '12345', now), null);
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', now), null);
});

test('secrets are random 160-bit values and the URI is what authenticator apps expect', () => {
  const a = generateTotpSecret();
  assert.notEqual(a, generateTotpSecret());
  assert.equal(base32Decode(a).length, 20);
  assert.equal(
    totpUri('ABC', 'jane@example.test', 'SomPay'),
    'otpauth://totp/SomPay%3Ajane%40example.test?secret=ABC&issuer=SomPay&algorithm=SHA1&digits=6&period=30',
  );
});
