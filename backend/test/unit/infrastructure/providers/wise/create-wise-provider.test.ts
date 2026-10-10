import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../../../src/config/env.ts';
import { createWiseProvider } from '../../../../../src/infrastructure/providers/wise/create-wise-provider.ts';
import { ProviderConfigError } from '../../../../../src/infrastructure/providers/provider-config-error.ts';
import {
  handlerTransport,
  RecordingAuditLog,
  silentWiseLogger,
} from '../../../../support/wise-fakes.ts';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/almapay',
  JWT_SECRET: 'a'.repeat(40),
  PAYOUT_PROVIDER: 'wise',
};
const deps = (env: Record<string, string>, extra: object = {}) => {
  const { transport, requests } = handlerTransport((req) =>
    req.url.endsWith('/currencies')
      ? { status: 200, body: [{ code: 'EUR', name: 'Euro' }] }
      : { status: 200, body: [] },
  );
  return {
    requests,
    deps: {
      env: parseEnv({ ...BASE, ...env }),
      logger: silentWiseLogger,
      auditLog: new RecordingAuditLog(),
      currencyMinorUnits: () => 2,
      transport,
      ...extra,
    },
  };
};

test('personal_token mode builds a provider that calls the sandbox with the token', async () => {
  const { deps: d, requests } = deps({
    WISE_AUTH_MODE: 'personal_token',
    WISE_API_TOKEN: 'tok-123',
  });
  const provider = createWiseProvider(d);
  const caps = await provider.getCapabilities();
  assert.deepEqual(caps.targetCurrencies, ['EUR']);
  assert.equal(requests[0]?.url, 'https://api.wise-sandbox.com/2026Q4/currencies');
  assert.equal(requests[0]?.headers.authorization, 'Bearer tok-123');
});

test('personal_token mode without a token fails at start-up', () => {
  assert.throws(() => createWiseProvider(deps({}).deps), ProviderConfigError);
});

test('oauth_partner mode needs a refresh-token store and its client credentials', () => {
  const env = {
    WISE_AUTH_MODE: 'oauth_partner',
    WISE_CLIENT_ID: 'id',
    WISE_CLIENT_SECRET: 'secret',
    WISE_AUTHORIZE_URL: 'https://wise.example/authorize',
    WISE_OAUTH_REDIRECT_URI: 'https://api.almapay.example/api/v1/onboarding/callback',
  };
  assert.throws(() => createWiseProvider(deps(env).deps), /store/);
  const store = { read: () => Promise.resolve(null), save: () => Promise.resolve() };
  const provider = createWiseProvider(deps(env, { refreshTokens: store }).deps);
  assert.ok(provider);
  assert.throws(
    () =>
      createWiseProvider(
        deps({ ...env, WISE_CLIENT_SECRET: undefined as never }, { refreshTokens: store }).deps,
      ),
    ProviderConfigError,
  );
});
