import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClientCredentialsWiseTokenProvider,
  StaticWiseTokenProvider,
} from '../../../../../src/infrastructure/providers/wise/wise-token-provider.ts';
import { WiseError } from '../../../../../src/infrastructure/providers/wise/wise-errors.ts';
import { handlerTransport, wiseFixture } from '../../../../support/wise-fakes.ts';

const tokenFixture = wiseFixture('oauth-token.json');

test('static provider returns the configured token', async () => {
  const provider = new StaticWiseTokenProvider('onboarding-token');
  assert.equal(await provider.getToken(), 'onboarding-token');
});

test('client-credentials provider POSTs the documented request and caches the token', async () => {
  const { transport, requests } = handlerTransport(() => ({ status: 200, body: tokenFixture }));
  const provider = new ClientCredentialsWiseTokenProvider({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    clientId: 'client-abc',
    clientSecret: 'secret-xyz',
    transport,
    timeoutMs: 5_000,
  });

  const first = await provider.getToken();
  const second = await provider.getToken();

  assert.equal(first, 'sandbox-access-token-abc123');
  assert.equal(second, first);
  assert.equal(requests.length, 1, 'token is cached');

  const req = requests[0]!;
  assert.equal(req.url, 'https://api.sandbox.transferwise.tech/oauth/token');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(
    req.headers.authorization,
    `Basic ${Buffer.from('client-abc:secret-xyz').toString('base64')}`,
  );
  assert.equal(req.body, 'grant_type=client_credentials');
});

test('re-fetches after invalidate()', async () => {
  const { transport, requests } = handlerTransport(() => ({ status: 200, body: tokenFixture }));
  const provider = new ClientCredentialsWiseTokenProvider({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    clientId: 'c',
    clientSecret: 's',
    transport,
    timeoutMs: 5_000,
  });
  await provider.getToken();
  provider.invalidate();
  await provider.getToken();
  assert.equal(requests.length, 2);
});

test('refreshes once the cached token is close to expiry', async () => {
  let now = 1_000_000;
  const { transport, requests } = handlerTransport(() => ({
    status: 200,
    body: { access_token: `t-${requests.length}`, token_type: 'bearer', expires_in: 120 },
  }));
  const provider = new ClientCredentialsWiseTokenProvider({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    clientId: 'c',
    clientSecret: 's',
    transport,
    timeoutMs: 5_000,
    now: () => now,
  });

  await provider.getToken();
  now += 70_000; // within the 60s refresh margin of the 120s TTL
  await provider.getToken();
  assert.equal(requests.length, 2);
});

test('surfaces a WiseError when the token endpoint rejects', async () => {
  const { transport } = handlerTransport(() => ({
    status: 401,
    body: { error: 'invalid_client' },
  }));
  const provider = new ClientCredentialsWiseTokenProvider({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    clientId: 'bad',
    clientSecret: 'bad',
    transport,
    timeoutMs: 5_000,
  });
  await assert.rejects(provider.getToken(), WiseError);
});
