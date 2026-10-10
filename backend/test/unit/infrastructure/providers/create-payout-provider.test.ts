import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../../src/config/env.ts';
import { NotImplementedError } from '../../../../src/domain/payout/errors.ts';
import { createPayoutProvider } from '../../../../src/infrastructure/providers/create-payout-provider.ts';
import { ProviderConfigError } from '../../../../src/infrastructure/providers/provider-config-error.ts';
import { createLogger } from '../../../../src/shared/logger.ts';
import { RecordingAuditLog } from '../../../support/transfer-fakes.ts';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/almapay',
  JWT_SECRET: 'a'.repeat(40),
};

function build(overrides: Record<string, string> = {}) {
  return createPayoutProvider({
    env: parseEnv({ ...BASE, ...overrides }),
    logger: createLogger({ level: 'error', write: () => {} }),
    auditLog: new RecordingAuditLog(),
    currencyMinorUnits: () => 2,
  });
}

test('the mock provider is the default and needs no other configuration', () => {
  assert.equal(build().name, 'mock');
  assert.equal(build({ PAYOUT_PROVIDER: 'mock' }).name, 'mock');
});

test('an unknown provider name is refused when the environment is parsed', () => {
  assert.throws(() => build({ PAYOUT_PROVIDER: 'paypal' }), /PAYOUT_PROVIDER/);
});

test('the mock provider is refused in production', () => {
  assert.throws(() => build({ NODE_ENV: 'production' }), ProviderConfigError);
});

test('wise fails at startup with a clear message when its credentials are missing', () => {
  assert.throws(
    () => build({ PAYOUT_PROVIDER: 'wise' }),
    /WISE_AUTH_MODE=personal_token needs WISE_API_TOKEN/,
  );
  assert.equal(build({ PAYOUT_PROVIDER: 'wise', WISE_API_TOKEN: 'sandbox-token' }).name, 'wise');
});

test('airwallex and currencycloud name the variables that are missing', () => {
  assert.throws(
    () => build({ PAYOUT_PROVIDER: 'airwallex', AIRWALLEX_CLIENT_ID: 'id' }),
    /these variables are not set: AIRWALLEX_API_KEY/,
  );
  assert.throws(
    () => build({ PAYOUT_PROVIDER: 'airwallex' }),
    /AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY/,
  );
  assert.throws(
    () => build({ PAYOUT_PROVIDER: 'currencycloud' }),
    /CURRENCYCLOUD_API_BASE_URL, CURRENCYCLOUD_LOGIN_ID, CURRENCYCLOUD_API_KEY/,
  );
});

test('switching provider is configuration only: each name builds its own adapter', () => {
  assert.equal(build({ PAYOUT_PROVIDER: 'mock' }).name, 'mock');
  assert.equal(build({ PAYOUT_PROVIDER: 'wise', WISE_API_TOKEN: 'sandbox-token' }).name, 'wise');
  assert.equal(
    build({ PAYOUT_PROVIDER: 'airwallex', AIRWALLEX_CLIENT_ID: 'id', AIRWALLEX_API_KEY: 'key' })
      .name,
    'airwallex',
  );
});

test('the Currencycloud stub starts when configured, then throws NotImplemented on every operation', async () => {
  const provider = build({
    PAYOUT_PROVIDER: 'currencycloud',
    CURRENCYCLOUD_API_BASE_URL: 'https://currencycloud.invalid',
    CURRENCYCLOUD_LOGIN_ID: 'login',
    CURRENCYCLOUD_API_KEY: 'key',
  });
  assert.equal(provider.name, 'currencycloud');
  await assert.rejects(provider.getCapabilities(), NotImplementedError);
  await assert.rejects(provider.listCurrencies(), NotImplementedError);
  assert.equal(provider.verifyWebhook({}, Buffer.from('{}')), false);
});
