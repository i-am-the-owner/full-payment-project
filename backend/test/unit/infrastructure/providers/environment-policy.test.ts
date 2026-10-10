import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../../src/config/env.ts';
import {
  assertEnvironmentPolicy,
  providerMode,
  resolveAppEnvironment,
} from '../../../../src/infrastructure/providers/environment-policy.ts';
import { ProviderConfigError } from '../../../../src/infrastructure/providers/provider-config-error.ts';

const BASE = { DATABASE_URL: 'postgres://u:p@localhost:5432/a', JWT_SECRET: 'a'.repeat(40) };
const WISE_SANDBOX = { PAYOUT_PROVIDER: 'wise', WISE_API_TOKEN: 'sandbox-token' };
const WISE_LIVE = {
  PAYOUT_PROVIDER: 'wise',
  WISE_AUTH_MODE: 'oauth_partner',
  WISE_CLIENT_ID: 'id',
  WISE_CLIENT_SECRET: 'secret',
  WISE_AUTHORIZE_URL: 'https://wise.example/authorize',
  WISE_OAUTH_REDIRECT_URI: 'https://api.example/cb',
  WISE_API_BASE_URL: 'https://api.wise.com',
  WISE_ALLOW_PRODUCTION: 'true',
  WISE_WEBHOOK_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
};
const run = (extra: Record<string, string>) =>
  assertEnvironmentPolicy(parseEnv({ ...BASE, ...extra }));

test('without APP_ENV, NODE_ENV decides: production stays production, anything else is development', () => {
  assert.equal(resolveAppEnvironment(parseEnv({ ...BASE })), 'development');
  assert.equal(resolveAppEnvironment(parseEnv({ ...BASE, NODE_ENV: 'production' })), 'production');
  assert.equal(resolveAppEnvironment(parseEnv({ ...BASE, NODE_ENV: 'test' })), 'development');
});

test('production refuses the mock and sandbox providers unless ALLOW_NON_PROD_PROVIDER=true', () => {
  const prod = { NODE_ENV: 'production', APP_ENV: 'production' };
  assert.throws(() => run({ ...prod }), ProviderConfigError);
  assert.throws(() => run({ ...prod }), /moves no real money/);
  assert.throws(() => run({ ...prod, ...WISE_SANDBOX }), /sandbox provider/);
  assert.deepEqual(run({ ...prod, ALLOW_NON_PROD_PROVIDER: 'true' }), {
    environment: 'production',
    mode: 'mock',
  });
  assert.equal(run({ ...prod, ...WISE_SANDBOX, ALLOW_NON_PROD_PROVIDER: 'true' }).mode, 'sandbox');
});

test('production accepts live provider configuration', () => {
  assert.deepEqual(run({ NODE_ENV: 'production', APP_ENV: 'production', ...WISE_LIVE }), {
    environment: 'production',
    mode: 'production',
  });
});

test('staging and development refuse live provider hosts, whatever the flag says', () => {
  for (const [appEnv, nodeEnv] of [
    ['staging', 'production'],
    ['development', 'development'],
  ] as const) {
    const env = {
      APP_ENV: appEnv,
      NODE_ENV: nodeEnv,
      ...WISE_LIVE,
      ALLOW_NON_PROD_PROVIDER: 'true',
    };
    // Staging reaches the policy; development is stopped even earlier by Wise's own guard.
    assert.throws(
      () => run(env),
      appEnv === 'staging' ? /refuses live provider/ : ProviderConfigError,
      appEnv,
    );
  }
});

test('staging runs on mock or sandbox, with production-level hardening', () => {
  assert.equal(run({ NODE_ENV: 'production', APP_ENV: 'staging' }).mode, 'mock');
  assert.equal(
    run({ NODE_ENV: 'production', APP_ENV: 'staging', ...WISE_SANDBOX }).mode,
    'sandbox',
  );
  assert.throws(
    () => run({ NODE_ENV: 'development', APP_ENV: 'staging' }),
    /needs NODE_ENV=production/,
  );
  assert.throws(
    () => run({ NODE_ENV: 'production', APP_ENV: 'development' }),
    /cannot be used with NODE_ENV=production/,
  );
});

test('each provider is classified from its own configuration', () => {
  assert.equal(providerMode(parseEnv({ ...BASE, ...WISE_SANDBOX })), 'sandbox');
  assert.equal(
    providerMode(
      parseEnv({
        ...BASE,
        PAYOUT_PROVIDER: 'airwallex',
        AIRWALLEX_CLIENT_ID: 'id',
        AIRWALLEX_API_KEY: 'key',
      }),
    ),
    'sandbox',
  );
  assert.equal(
    providerMode(
      parseEnv({
        ...BASE,
        PAYOUT_PROVIDER: 'currencycloud',
        CURRENCYCLOUD_API_BASE_URL: 'https://devapi.currencycloud.com',
        CURRENCYCLOUD_LOGIN_ID: 'x',
        CURRENCYCLOUD_API_KEY: 'y',
      }),
    ),
    'sandbox',
  );
  assert.equal(
    providerMode(
      parseEnv({
        ...BASE,
        PAYOUT_PROVIDER: 'currencycloud',
        CURRENCYCLOUD_API_BASE_URL: 'https://api.currencycloud.com',
        CURRENCYCLOUD_LOGIN_ID: 'x',
        CURRENCYCLOUD_API_KEY: 'y',
      }),
    ),
    'production',
    'any other host is treated as live',
  );
});
