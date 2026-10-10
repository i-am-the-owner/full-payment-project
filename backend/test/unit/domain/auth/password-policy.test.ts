import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePassword } from '../../../../src/domain/auth/password-policy.ts';

const policy = { minLength: 12 };

test('accepts a sufficiently long passphrase', () => {
  assert.deepEqual(evaluatePassword('correct horse battery staple', policy), {
    ok: true,
    problems: [],
  });
});

test('rejects a password shorter than the minimum', () => {
  const result = evaluatePassword('short', policy);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('at least 12')));
});

test('rejects a single repeated character even when long', () => {
  const result = evaluatePassword('aaaaaaaaaaaaaaaa', policy);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('repeated character')));
});

test('rejects a common password', () => {
  assert.equal(evaluatePassword('password123', { minLength: 8 }).ok, false);
});

test('does not impose composition rules', () => {
  assert.equal(evaluatePassword('alllowercaseletters', policy).ok, true);
});
