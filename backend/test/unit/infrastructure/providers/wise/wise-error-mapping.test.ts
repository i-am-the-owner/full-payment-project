import test from 'node:test';
import assert from 'node:assert/strict';
import { WiseError } from '../../../../../src/infrastructure/providers/wise/wise-errors.ts';
import { toWiseError } from '../../../../../src/infrastructure/providers/wise/wise-http-client.ts';
import { WiseUserTokenManager } from '../../../../../src/infrastructure/providers/wise/wise-user-tokens.ts';
import { toPayoutError } from '../../../../../src/infrastructure/providers/wise/wise-payout-provider.ts';
import {
  DuplicateError,
  NeedsRelinkError,
  ProviderRejectedError,
  ProviderUnavailableError,
} from '../../../../../src/domain/payout/errors.ts';
import { handlerTransport, type FakeResponseSpec } from '../../../../support/wise-fakes.ts';

const noHeaders = { get: () => null };

test('every HTTP status maps to a stable Wise error code and then to a typed payout error', () => {
  const cases: [number, string, new (...a: never[]) => unknown, boolean | undefined][] = [
    [401, 'wise_auth', ProviderUnavailableError, false],
    [403, 'wise_forbidden', ProviderRejectedError, undefined],
    [404, 'wise_not_found', ProviderRejectedError, undefined],
    [409, 'wise_conflict', DuplicateError, undefined],
    [429, 'wise_rate_limited', ProviderUnavailableError, false],
    [500, 'wise_unavailable', ProviderUnavailableError, true],
    [503, 'wise_unavailable', ProviderUnavailableError, true],
    [418, 'wise_unexpected', ProviderUnavailableError, true],
  ];
  for (const [status, code, payoutClass, outcomeUnknown] of cases) {
    const error = toWiseError(status, noHeaders, '{"message":"x"}');
    assert.equal(error.code, code, String(status));
    const mapped = toPayoutError(error);
    assert.ok(mapped instanceof payoutClass, `${status} -> ${payoutClass.name}`);
    if (outcomeUnknown !== undefined) {
      assert.equal(
        (mapped as ProviderUnavailableError).outcomeUnknown,
        outcomeUnknown,
        String(status),
      );
    }
  }
  // Only rate limits and server errors are retryable.
  assert.equal(toWiseError(429, noHeaders, '').retryable, true);
  assert.equal(toWiseError(404, noHeaders, '').retryable, false);
  assert.ok(
    toPayoutError(new NeedsRelinkError()) instanceof NeedsRelinkError,
    'other errors pass through',
  );
});

test('an unreadable error body does not break error mapping', () => {
  assert.equal(toWiseError(500, noHeaders, '<html>').code, 'wise_unavailable');
  assert.equal(toWiseError(422, noHeaders, 'not json').code, 'wise_validation');
});

function tokens(route: () => FakeResponseSpec | Promise<FakeResponseSpec>, fail = false) {
  const { transport } = handlerTransport(route);
  return new WiseUserTokenManager({
    baseUrl: 'https://api.wise-sandbox.com',
    clientId: 'id',
    clientSecret: 'secret',
    transport: fail
      ? () => Promise.reject(new Error('socket hang up with refresh_token=SECRET'))
      : transport,
    timeoutMs: 1000,
    store: { read: () => Promise.resolve('rt'), save: () => Promise.resolve() },
  });
}

test('token endpoint failures: unreachable, 5xx/429 retryable, refusal is an auth error; no secret in the message', async () => {
  await assert.rejects(tokens(() => ({ status: 200 }), true).accessTokenFor('c'), (e: unknown) => {
    assert.ok(e instanceof WiseError && e.code === 'wise_unavailable' && e.retryable);
    assert.ok(!e.message.includes('SECRET'));
    return true;
  });
  for (const status of [500, 429]) {
    await assert.rejects(
      tokens(() => ({ status })).accessTokenFor('c'),
      (e: unknown) => e instanceof WiseError && e.code === 'wise_unavailable' && e.retryable,
    );
  }
  await assert.rejects(
    tokens(() => ({ status: 401, body: { error: 'invalid_client' } })).accessTokenFor('c'),
    (e: unknown) =>
      e instanceof WiseError && e.code === 'wise_auth' && e.providerCode === 'invalid_client',
  );
  await assert.rejects(
    tokens(() => ({ status: 200, text: 'not json' })).accessTokenFor('c'),
    (e: unknown) => e instanceof WiseError && e.code === 'wise_auth',
  );
});
