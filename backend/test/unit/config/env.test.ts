import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../src/config/env.ts';

const MINIMAL = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/almapay',
  JWT_SECRET: 'a'.repeat(32),
};

test('parseEnv applies defaults when only the required keys are set', () => {
  const env = parseEnv({ ...MINIMAL });
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.PORT, 3000);
  assert.equal(env.LOG_LEVEL, 'info');
  assert.equal(env.APP_VERSION, undefined);
  assert.equal(env.DATABASE_POOL_MAX, 10);
  assert.equal(env.JWT_ISSUER, 'almapay');
  assert.equal(env.JWT_AUDIENCE, 'almapay-mobile');
  assert.equal(env.ACCESS_TOKEN_TTL_SECONDS, 900);
  assert.equal(env.TRUST_PROXY, false);
  assert.equal(env.HSTS_ENABLED, undefined);
  assert.equal(env.RATE_LIMIT_MAX, 300);
  assert.equal(env.AUTH_RATE_LIMIT_MAX, 20);
});

test('parseEnv requires DATABASE_URL', () => {
  assert.throws(() => parseEnv({ JWT_SECRET: 'a'.repeat(32) }), /DATABASE_URL/);
});

test('parseEnv requires a JWT_SECRET of at least 32 characters', () => {
  assert.throws(
    () => parseEnv({ ...MINIMAL, JWT_SECRET: 'too-short' }),
    /JWT_SECRET must be at least 32 characters/,
  );
});

test('parseEnv coerces PORT to a number', () => {
  const env = parseEnv({ ...MINIMAL, PORT: '8080' });
  assert.equal(env.PORT, 8080);
});

test('parseEnv rejects an unknown NODE_ENV', () => {
  assert.throws(
    () => parseEnv({ ...MINIMAL, NODE_ENV: 'staging' }),
    /Invalid environment configuration/,
  );
});

test('parseEnv rejects a non-numeric PORT', () => {
  assert.throws(() => parseEnv({ ...MINIMAL, PORT: 'abc' }), /PORT/);
});

test('parseEnv rejects an out-of-range PORT', () => {
  assert.throws(() => parseEnv({ ...MINIMAL, PORT: '70000' }), /PORT/);
});

test('parseEnv parses boolean-ish TRUST_PROXY values', () => {
  assert.equal(parseEnv({ ...MINIMAL, TRUST_PROXY: 'true' }).TRUST_PROXY, true);
  assert.equal(parseEnv({ ...MINIMAL, TRUST_PROXY: '1' }).TRUST_PROXY, true);
  assert.equal(parseEnv({ ...MINIMAL, TRUST_PROXY: 'false' }).TRUST_PROXY, false);
  assert.throws(() => parseEnv({ ...MINIMAL, TRUST_PROXY: 'yes' }), /TRUST_PROXY/);
});

test('the error summary never contains the secret value', () => {
  try {
    parseEnv({ ...MINIMAL, JWT_SECRET: 'short', DATABASE_URL: 'not-a-url' });
    assert.fail('expected parseEnv to throw');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /short/);
    assert.doesNotMatch(error.message, /not-a-url/);
  }
});
