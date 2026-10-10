import test from 'node:test';
import assert from 'node:assert/strict';
import { WiseError } from '../../../../../src/infrastructure/providers/wise/wise-errors.ts';
import { WiseUserTokenManager } from '../../../../../src/infrastructure/providers/wise/wise-user-tokens.ts';
import { handlerTransport, type FakeResponseSpec } from '../../../../support/wise-fakes.ts';

// UNTESTED against real Wise partner credentials: these use mocked HTTP only.

function manager(route: () => FakeResponseSpec, initial: Record<string, string> = { c1: 'rt-1' }) {
  const { transport, requests } = handlerTransport(route);
  const stored = new Map(Object.entries(initial));
  let now = 1_000_000;
  const tokens = new WiseUserTokenManager({
    baseUrl: 'https://api.wise-sandbox.com',
    clientId: 'id',
    clientSecret: 'secret',
    transport,
    timeoutMs: 1000,
    store: {
      read: (ref) => Promise.resolve(stored.get(ref) ?? null),
      save: (ref, token) => Promise.resolve(void stored.set(ref, token)),
    },
    now: () => now,
  });
  return { tokens, requests, stored, advance: (ms: number) => (now += ms) };
}

const ok = (access: string, refresh: string): FakeResponseSpec => ({
  status: 200,
  body: { access_token: access, refresh_token: refresh, expires_in: 43199 },
});

test('refreshes with the stored refresh token, caches the access token, and keeps the rotated refresh token', async () => {
  const { tokens, requests, stored, advance } = manager(() => ok('at-1', 'rt-2'));
  assert.equal(await tokens.accessTokenFor('c1'), 'at-1');
  assert.equal(await tokens.accessTokenFor('c1'), 'at-1');
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests[0]?.body)), {
    grant_type: 'refresh_token',
    refresh_token: 'rt-1',
  });
  assert.equal(stored.get('c1'), 'rt-2');
  advance(43_000_000);
  await tokens.accessTokenFor('c1');
  assert.equal(requests.length, 2, 'refreshed again once near expiry');
});

test('simultaneous calls share one refresh', async () => {
  const { tokens, requests } = manager(() => ok('at-1', 'rt-1'));
  const all = await Promise.all([1, 2, 3].map(() => tokens.accessTokenFor('c1')));
  assert.deepEqual(all, ['at-1', 'at-1', 'at-1']);
  assert.equal(requests.length, 1);
});

test('a refresh token Wise rejects, or none stored, means the customer must connect again', async () => {
  const rejected = manager(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  await assert.rejects(
    rejected.tokens.accessTokenFor('c1'),
    (e: unknown) => e instanceof WiseError && e.code === 'wise_relink_required',
  );
  const none = manager(() => ok('x', 'y'), {});
  await assert.rejects(
    none.tokens.accessTokenFor('c1'),
    (e: unknown) => e instanceof WiseError && e.code === 'wise_relink_required',
  );
  assert.equal(none.requests.length, 0);
});

test('the authorization code is exchanged with client credentials', async () => {
  const { tokens, requests } = manager(() => ok('at-1', 'rt-1'));
  const result = await tokens.exchangeAuthorizationCode('code-1', 'https://x.example/cb');
  assert.equal(result.accessToken, 'at-1');
  assert.equal(result.refreshToken, 'rt-1');
  assert.equal(
    requests[0]?.headers.authorization,
    `Basic ${Buffer.from('id:secret').toString('base64')}`,
  );
  assert.equal(new URLSearchParams(requests[0]?.body).get('grant_type'), 'authorization_code');
});
