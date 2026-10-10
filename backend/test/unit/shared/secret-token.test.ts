import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretToken, hashSecretToken } from '../../../src/shared/secret-token.ts';

test('generates a high-entropy url-safe token with a matching hash', () => {
  const { raw, hash } = generateSecretToken();
  assert.match(raw, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(hash, hashSecretToken(raw));
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('two tokens are never equal', () => {
  const a = generateSecretToken();
  const b = generateSecretToken();
  assert.notEqual(a.raw, b.raw);
  assert.notEqual(a.hash, b.hash);
});

test('hashing is deterministic', () => {
  assert.equal(hashSecretToken('abc'), hashSecretToken('abc'));
});
