import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  loadTokenCipher,
  TokenCipher,
  TokenCipherError,
} from '../../../../src/infrastructure/crypto/token-cipher.ts';

const KEY_1 = randomBytes(32);
const KEY_2 = randomBytes(32);
const CONTEXT = 'provider_links:user-1:wise';
const TOKEN = 'refresh-token-9f8e7d6c5b4a';

function cipher(currentVersion = 1, keys: [number, Buffer][] = [[1, KEY_1]]): TokenCipher {
  return new TokenCipher({ currentVersion, keys: new Map(keys) });
}

test('a value round-trips and records the key version', () => {
  const c = cipher();
  const encrypted = c.encrypt(TOKEN, CONTEXT);
  assert.equal(encrypted.keyVersion, 1);
  assert.equal(c.decrypt(encrypted, CONTEXT), TOKEN);
});

test('the ciphertext does not contain the plaintext', () => {
  const { ciphertext } = cipher().encrypt(TOKEN, CONTEXT);
  assert.equal(ciphertext.includes(TOKEN), false);
  assert.equal(Buffer.from(ciphertext, 'base64').toString('latin1').includes(TOKEN), false);
});

test('encrypting the same value twice gives different ciphertexts (random IV)', () => {
  const c = cipher();
  const a = c.encrypt(TOKEN, CONTEXT);
  const b = c.encrypt(TOKEN, CONTEXT);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(c.decrypt(a, CONTEXT), c.decrypt(b, CONTEXT));
});

test('empty and non-ASCII values round-trip', () => {
  const c = cipher();
  for (const value of ['', 'tökén-✓-令牌', 'x'.repeat(5000)]) {
    assert.equal(c.decrypt(c.encrypt(value, CONTEXT), CONTEXT), value);
  }
});

test('a tampered ciphertext is rejected', () => {
  const c = cipher();
  const encrypted = c.encrypt(TOKEN, CONTEXT);
  const raw = Buffer.from(encrypted.ciphertext, 'base64');
  for (const index of [0, 12, raw.length - 1]) {
    const altered = Buffer.from(raw);
    altered[index] = altered[index]! ^ 0x01;
    assert.throws(
      () => c.decrypt({ ...encrypted, ciphertext: altered.toString('base64') }, CONTEXT),
      TokenCipherError,
      `byte ${index}`,
    );
  }
});

test('a value cannot be moved to another row (context is authenticated)', () => {
  const c = cipher();
  const encrypted = c.encrypt(TOKEN, CONTEXT);
  assert.throws(() => c.decrypt(encrypted, 'provider_links:user-2:wise'), TokenCipherError);
});

test('the wrong key cannot decrypt', () => {
  const encrypted = cipher(1, [[1, KEY_1]]).encrypt(TOKEN, CONTEXT);
  assert.throws(() => cipher(1, [[1, KEY_2]]).decrypt(encrypted, CONTEXT), TokenCipherError);
});

test('a malformed value is rejected', () => {
  assert.throws(
    () => cipher().decrypt({ ciphertext: 'c2hvcnQ=', keyVersion: 1 }, CONTEXT),
    /malformed/,
  );
});

test('errors never reveal the plaintext, the ciphertext or the key', () => {
  const c = cipher();
  const encrypted = c.encrypt(TOKEN, CONTEXT);
  try {
    c.decrypt(encrypted, 'wrong-context');
    assert.fail('should have thrown');
  } catch (error) {
    const text = `${String(error)} ${JSON.stringify(error)}`;
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(encrypted.ciphertext), false);
    assert.equal(text.includes(KEY_1.toString('base64')), false);
  }
});

// --- Key rotation -----------------------------------------------------------

test('after rotation, new values use the new key and old values stay readable', () => {
  const before = cipher(1, [[1, KEY_1]]);
  const old = before.encrypt(TOKEN, CONTEXT);

  const after = cipher(2, [
    [1, KEY_1],
    [2, KEY_2],
  ]);
  assert.equal(after.decrypt(old, CONTEXT), TOKEN);
  assert.equal(after.needsRotation(old), true);

  const fresh = after.encrypt(TOKEN, CONTEXT);
  assert.equal(fresh.keyVersion, 2);
  assert.equal(after.needsRotation(fresh), false);
  // The retired key alone can no longer read values written with the new key.
  assert.throws(
    () => before.decrypt(fresh, CONTEXT),
    /No encryption key is configured for version 2/,
  );
});

test('a value whose key has been removed cannot be read, and says which version is missing', () => {
  const old = cipher(1, [[1, KEY_1]]).encrypt(TOKEN, CONTEXT);
  assert.throws(
    () => cipher(2, [[2, KEY_2]]).decrypt(old, CONTEXT),
    /No encryption key is configured for version 1/,
  );
});

test('the cipher refuses a wrong-sized key, a bad version or a missing current key', () => {
  assert.throws(() => cipher(1, [[1, randomBytes(16)]]), /must be 32 bytes/);
  assert.throws(() => cipher(0, [[0, KEY_1]]), /Invalid encryption key version/);
  assert.throws(() => cipher(2, [[1, KEY_1]]), /current version 2/);
});

// --- Loading from the environment -------------------------------------------

test('no ENCRYPTION_KEY means no cipher (callers must then refuse to store tokens)', () => {
  assert.equal(loadTokenCipher({ ENCRYPTION_KEY_VERSION: 1 }), null);
});

test('loads the current key and previous keys from the environment', () => {
  const loaded = loadTokenCipher({
    ENCRYPTION_KEY: KEY_2.toString('base64'),
    ENCRYPTION_KEY_VERSION: 2,
    ENCRYPTION_PREVIOUS_KEYS: `1:${KEY_1.toString('base64')}`,
  });
  assert.ok(loaded);
  assert.equal(loaded.currentVersion, 2);
  const old = cipher(1, [[1, KEY_1]]).encrypt(TOKEN, CONTEXT);
  assert.equal(loaded.decrypt(old, CONTEXT), TOKEN);
});

test('bad environment values fail with a clear message that does not echo the key', () => {
  const short = randomBytes(8).toString('base64');
  assert.throws(
    () => loadTokenCipher({ ENCRYPTION_KEY: short, ENCRYPTION_KEY_VERSION: 1 }),
    (error: unknown) =>
      error instanceof TokenCipherError &&
      /ENCRYPTION_KEY must be 32 random bytes/.test(error.message) &&
      !error.message.includes(short),
  );
  const good = KEY_1.toString('base64');
  assert.throws(
    () =>
      loadTokenCipher({
        ENCRYPTION_KEY: good,
        ENCRYPTION_KEY_VERSION: 1,
        ENCRYPTION_PREVIOUS_KEYS: 'nonsense',
      }),
    /must look like/,
  );
  assert.throws(
    () =>
      loadTokenCipher({
        ENCRYPTION_KEY: good,
        ENCRYPTION_KEY_VERSION: 1,
        ENCRYPTION_PREVIOUS_KEYS: `1:${good}`,
      }),
    /repeats key version 1/,
  );
  assert.throws(
    () => loadTokenCipher({ ENCRYPTION_KEY_VERSION: 1, ENCRYPTION_PREVIOUS_KEYS: `1:${good}` }),
    /ENCRYPTION_KEY is not/,
  );
});
