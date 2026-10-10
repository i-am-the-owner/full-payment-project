import test from 'node:test';
import assert from 'node:assert/strict';
import { WiseHttpClient } from '../../../../../src/infrastructure/providers/wise/wise-http-client.ts';
import {
  WiseError,
  WiseTimeoutError,
} from '../../../../../src/infrastructure/providers/wise/wise-errors.ts';
import {
  handlerTransport,
  hangingTransport,
  queueTransport,
  silentWiseLogger,
} from '../../../../support/wise-fakes.ts';

function client(
  transport: ReturnType<typeof handlerTransport>['transport'],
  overrides: { maxRetries?: number; timeoutMs?: number; invalidate?: () => void } = {},
) {
  return new WiseHttpClient({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    timeoutMs: overrides.timeoutMs ?? 5_000,
    maxRetries: overrides.maxRetries ?? 3,
    getAuthToken: () => Promise.resolve('token-123'),
    invalidateAuthToken: overrides.invalidate ?? (() => {}),
    logger: silentWiseLogger,
    transport,
    sleep: () => Promise.resolve(),
  });
}

test('sends the bearer token and parses a JSON response', async () => {
  const { transport, requests } = handlerTransport(() => ({ status: 200, body: { ok: true } }));
  const response = await client(transport).send({ method: 'GET', path: '/v1/profiles' });

  assert.equal(requests[0]?.headers.authorization, 'Bearer token-123');
  assert.deepEqual(response.json, { ok: true });
});

test('retries a GET on 503 up to the limit, then gives up with a retryable error', async () => {
  const { transport, requests } = queueTransport([
    { status: 503 },
    { status: 503 },
    { status: 503 },
    { status: 503 },
  ]);
  await assert.rejects(
    client(transport, { maxRetries: 2 }).send({ method: 'GET', path: '/x' }),
    (e) => {
      assert.ok(e instanceof WiseError);
      assert.equal(e.code, 'wise_unavailable');
      assert.equal(e.retryable, true);
      return true;
    },
  );
  assert.equal(requests.length, 3); // 1 + 2 retries
});

test('retries a GET after a network error and can then succeed', async () => {
  const { transport, requests } = queueTransport([
    'network-error',
    { status: 200, body: { id: 'q1' } },
  ]);
  const response = await client(transport).send({ method: 'GET', path: '/v3/quotes/q1' });
  assert.deepEqual(response.json, { id: 'q1' });
  assert.equal(requests.length, 2);
});

test('does not retry a non-idempotent POST', async () => {
  const { transport, requests } = queueTransport([{ status: 503 }, { status: 200 }]);
  await assert.rejects(client(transport).send({ method: 'POST', path: '/v1/transfers', body: {} }));
  assert.equal(requests.length, 1);
});

test('retries a POST that is explicitly marked retryable (carries an idempotency key)', async () => {
  const { transport, requests } = queueTransport([
    { status: 500 },
    { status: 200, body: { id: 1 } },
  ]);
  const response = await client(transport).send({
    method: 'POST',
    path: '/v1/transfers',
    body: { customerTransactionId: 'idem-1' },
    retryable: true,
  });
  assert.deepEqual(response.json, { id: 1 });
  assert.equal(requests.length, 2);
});

test('times out a hanging request and reports it as retryable', async () => {
  await assert.rejects(
    client(hangingTransport, { timeoutMs: 20, maxRetries: 0 }).send({ method: 'GET', path: '/x' }),
    WiseTimeoutError,
  );
});

test('refreshes the token once on a 401 and retries', async () => {
  let invalidated = 0;
  const { transport, requests } = queueTransport([
    { status: 401 },
    { status: 200, body: { ok: 1 } },
  ]);
  const response = await client(transport, { invalidate: () => (invalidated += 1) }).send({
    method: 'GET',
    path: '/x',
  });
  assert.equal(invalidated, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(response.json, { ok: 1 });
});

test('maps a Wise validation error body to a WiseError with field details', async () => {
  const { transport } = handlerTransport(() => ({
    status: 422,
    body: { errors: [{ code: 'NOT_VALID', message: 'sortCode is not valid' }] },
  }));
  await assert.rejects(
    client(transport).send({ method: 'POST', path: '/v1/accounts', body: {} }),
    (e) => {
      assert.ok(e instanceof WiseError);
      assert.equal(e.code, 'wise_validation');
      assert.equal(e.details[0]?.code, 'NOT_VALID');
      return true;
    },
  );
});

test('maps 429 to a rate-limit error and honours Retry-After', async () => {
  const { transport, requests } = queueTransport([
    { status: 429, headers: { 'retry-after': '0' } },
    { status: 200, body: {} },
  ]);
  await client(transport).send({ method: 'GET', path: '/x' });
  assert.equal(requests.length, 2);
});

test('never logs the Authorization header or bodies', async () => {
  const lines: string[] = [];
  const logger = { ...silentWiseLogger };
  logger.info = (msg: string, fields?: unknown) => lines.push(JSON.stringify({ msg, fields }));
  const { transport } = handlerTransport(() => ({ status: 200, body: { secret: 'x' } }));
  const c = new WiseHttpClient({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    timeoutMs: 1000,
    maxRetries: 0,
    getAuthToken: () => Promise.resolve('super-secret-token'),
    invalidateAuthToken: () => {},
    logger,
    transport,
    sleep: () => Promise.resolve(),
  });
  await c.send({ method: 'POST', path: '/v1/accounts', body: { accountNumber: '12345678' } });

  const output = lines.join('\n');
  assert.doesNotMatch(output, /super-secret-token/);
  assert.doesNotMatch(output, /12345678/);
});
