import test from 'node:test';
import assert from 'node:assert/strict';
import { Argon2PasswordHasher } from '../../../../src/infrastructure/auth/argon2-password-hasher.ts';

const hasher = new Argon2PasswordHasher();

test('hashes to an argon2id string that is not the plaintext', async () => {
  const hash = await hasher.hash('correct horse battery staple');
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.ok(!hash.includes('correct horse battery staple'));
});

test('verifies the right password and rejects the wrong one', async () => {
  const hash = await hasher.hash('super secret passphrase');
  assert.equal(await hasher.verify(hash, 'super secret passphrase'), true);
  assert.equal(await hasher.verify(hash, 'super secret passphras'), false);
});

test('verify returns false (never throws) for a malformed stored hash', async () => {
  assert.equal(await hasher.verify('not-a-hash', 'anything'), false);
});

test('needsRehash is false for a current-parameter hash', async () => {
  assert.equal(hasher.needsRehash(await hasher.hash('whatever passphrase')), false);
});

test('needsRehash is true for a weaker or unparseable hash', () => {
  assert.equal(hasher.needsRehash('$argon2id$v=19$m=4096,t=2,p=1$abc$def'), true);
  assert.equal(hasher.needsRehash('$2b$10$something'), true);
});
