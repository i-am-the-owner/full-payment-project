import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../../../src/config/env.ts';
import { loadAirwallexConfig } from '../../../../../src/infrastructure/providers/airwallex/airwallex-config.ts';
import { ProviderConfigError } from '../../../../../src/infrastructure/providers/provider-config-error.ts';
import { AWX_ENV } from '../../../../support/airwallex-fakes.ts';

function config(overrides: Record<string, string | undefined> = {}) {
  return loadAirwallexConfig(parseEnv({ ...AWX_ENV, ...overrides }));
}

test('defaults to the sandbox, never production', () => {
  const loaded = config();
  assert.equal(loaded.baseUrl, 'https://api.sandbox.airwallex.com');
  assert.equal(loaded.isSandbox, true);
  assert.equal(loaded.apiVersion, '2026-08-21');
  assert.equal(loaded.legalEntityType, 'INDIVIDUAL');
});

test('names the variables that are missing', () => {
  assert.throws(
    () => config({ AIRWALLEX_CLIENT_ID: undefined, AIRWALLEX_API_KEY: undefined }),
    (error: unknown) =>
      error instanceof ProviderConfigError &&
      /AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY/.test(error.message),
  );
});

test('production needs an explicit opt-in, NODE_ENV=production and a webhook secret', () => {
  const production = { AIRWALLEX_BASE_URL: 'https://api.airwallex.com' };
  assert.throws(() => config(production), /AIRWALLEX_ALLOW_PRODUCTION/);
  assert.throws(() => config({ ...production, AIRWALLEX_ALLOW_PRODUCTION: 'true' }), /NODE_ENV/);
  assert.throws(
    () =>
      config({
        ...production,
        AIRWALLEX_ALLOW_PRODUCTION: 'true',
        NODE_ENV: 'production',
        AIRWALLEX_WEBHOOK_SECRET: undefined,
      }),
    /AIRWALLEX_WEBHOOK_SECRET/,
  );
  const loaded = config({
    ...production,
    AIRWALLEX_ALLOW_PRODUCTION: 'true',
    NODE_ENV: 'production',
  });
  assert.equal(loaded.isSandbox, false);
});
