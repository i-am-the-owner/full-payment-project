import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../../../src/config/env.ts';
import {
  loadWiseConfig,
  WiseConfigError,
} from '../../../../../src/infrastructure/providers/wise/wise-config.ts';
import { ProviderConfigError } from '../../../../../src/infrastructure/providers/provider-config-error.ts';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/almapay',
  JWT_SECRET: 'a'.repeat(40),
  PAYOUT_PROVIDER: 'wise',
  WISE_API_TOKEN: 'onboarding-token',
};
const PEM = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----';

function wise(overrides: Record<string, string | undefined>): ReturnType<typeof loadWiseConfig> {
  return loadWiseConfig(parseEnv({ ...BASE, ...overrides }));
}

test('defaults to the sandbox with the bundled sandbox webhook key', () => {
  const config = wise({});
  assert.equal(config.baseUrl, 'https://api.wise-sandbox.com');
  assert.equal(config.isSandbox, true);
  assert.ok(config.webhookPublicKeyPem.includes('BEGIN PUBLIC KEY'));
  assert.equal(config.apiToken, 'onboarding-token');
});

test('there is no shared profile id: the profile always comes from the customer link', () => {
  assert.equal('profileId' in wise({}), false);
});

test('personal_token mode requires a token, and says how to get partner credentials instead', () => {
  assert.throws(() => wise({ WISE_API_TOKEN: undefined }), WiseConfigError);
  assert.throws(() => wise({ WISE_API_TOKEN: undefined }), ProviderConfigError);
  assert.throws(() => wise({ WISE_API_TOKEN: undefined }), /oauth_partner/);
});

const PARTNER = {
  WISE_AUTH_MODE: 'oauth_partner',
  WISE_API_TOKEN: undefined,
  WISE_CLIENT_ID: 'client-abc',
  WISE_CLIENT_SECRET: 'secret-xyz',
  WISE_AUTHORIZE_URL: 'https://wise.example/oauth/authorize',
};

test('partner OAuth needs client credentials and the authorise address', () => {
  const config = wise(PARTNER);
  assert.equal(config.authMode, 'oauth_partner');
  assert.equal(config.clientId, 'client-abc');
  assert.equal(config.authorizeUrl, 'https://wise.example/oauth/authorize');
  assert.throws(
    () => wise({ ...PARTNER, WISE_CLIENT_SECRET: undefined }),
    /WISE_CLIENT_ID and WISE_CLIENT_SECRET/,
  );
  assert.throws(() => wise({ ...PARTNER, WISE_AUTHORIZE_URL: undefined }), /WISE_AUTHORIZE_URL/);
  assert.throws(
    () => wise({ ...PARTNER, WISE_AUTHORIZE_URL: 'http://wise.example/a' }),
    /WISE_AUTHORIZE_URL/,
  );
});

test('the redirect URI defaults to this backend’s onboarding callback and can be set', () => {
  assert.equal(
    wise({ ...PARTNER, PUBLIC_API_URL: 'https://api.almapay.example/' }).oauthRedirectUri,
    'https://api.almapay.example/api/v1/onboarding/callback',
  );
  assert.equal(
    wise({ ...PARTNER, WISE_OAUTH_REDIRECT_URI: 'https://x.example/cb' }).oauthRedirectUri,
    'https://x.example/cb',
  );
});

test('the auth mode defaults to personal_token, and a personal token is for the sandbox only', () => {
  assert.equal(wise({}).authMode, 'personal_token');
  assert.equal(wise({}).apiVersion, '2026Q4');
  assert.deepEqual(wise({}).sourceCurrencies, ['GBP']);
  assert.throws(() => wise({ WISE_AUTH_MODE: 'basic' }), /WISE_AUTH_MODE/);
  // A production host with a personal token: one account would be every customer's sender.
  assert.throws(
    () =>
      wise({
        WISE_API_BASE_URL: 'https://api.wise.com',
        WISE_ALLOW_PRODUCTION: 'true',
        NODE_ENV: 'production',
        ENCRYPTION_KEY: 'x'.repeat(44),
        WISE_WEBHOOK_PUBLIC_KEY: PEM,
      }),
    /personal_token is for the sandbox only/,
  );
});

test('refuses a production Wise host without an explicit opt-in', () => {
  assert.throws(() => wise({ WISE_API_BASE_URL: 'https://api.transferwise.com' }), WiseConfigError);
  assert.throws(() => wise({ WISE_API_BASE_URL: 'https://api.wise.com' }), WiseConfigError);
});

test('a production Wise host is refused unless NODE_ENV is production', () => {
  assert.throws(
    () =>
      wise({
        WISE_API_BASE_URL: 'https://api.wise.com',
        WISE_ALLOW_PRODUCTION: 'true',
        WISE_WEBHOOK_PUBLIC_KEY: PEM,
      }),
    /NODE_ENV/,
  );
});

test('a production Wise host never falls back to the bundled sandbox webhook key', () => {
  const production = {
    NODE_ENV: 'production',
    WISE_API_BASE_URL: 'https://api.wise.com',
    WISE_ALLOW_PRODUCTION: 'true',
  };
  assert.throws(() => wise(production), /WISE_WEBHOOK_PUBLIC_KEY/);
  const config = wise({ ...production, ...PARTNER, WISE_WEBHOOK_PUBLIC_KEY: PEM });
  assert.equal(config.isSandbox, false);
  assert.equal(config.webhookPublicKeyPem, PEM);
});

test('only known sandbox hosts are sandbox; the production mTLS host and any unknown host get the strict production rules', () => {
  for (const sandbox of [
    'https://api.sandbox.transferwise.tech',
    'https://api.wise-sandbox.com',
    'https://api-mtls.wise-sandbox.com',
  ]) {
    assert.equal(wise({ WISE_API_BASE_URL: sandbox }).isSandbox, true, sandbox);
  }
  for (const production of [
    'https://api-mtls.transferwise.com',
    'https://api.transferwise.com',
    'https://api.wise.com',
    'https://some-new-wise-host.example.com',
  ]) {
    // Not allowed without the explicit production switch...
    assert.throws(() => wise({ WISE_API_BASE_URL: production }), WiseConfigError, production);
    // ...and never with the sandbox webhook key, even with the switch and NODE_ENV=production.
    assert.throws(
      () =>
        wise({
          WISE_API_BASE_URL: production,
          WISE_ALLOW_PRODUCTION: 'true',
          NODE_ENV: 'production',
          ENCRYPTION_KEY: 'x'.repeat(44),
        }),
      /WISE_WEBHOOK_PUBLIC_KEY must be set explicitly/,
      production,
    );
  }
});
