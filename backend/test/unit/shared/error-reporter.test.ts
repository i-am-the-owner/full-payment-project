import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSentryReporter,
  noopErrorReporter,
  parseDsn,
} from '../../../src/shared/error-reporter.ts';
import { createLogger } from '../../../src/shared/logger.ts';

const logger = createLogger({ level: 'error', write: () => {} });

test('a DSN is parsed into the envelope URL; anything unusable is rejected', () => {
  assert.deepEqual(parseDsn('https://abc123@o1.ingest.example.io/42'), {
    key: 'abc123',
    envelopeUrl: 'https://o1.ingest.example.io/api/42/envelope/?sentry_version=7&sentry_key=abc123',
  });
  for (const bad of ['http://k@h/1', 'https://h/1', 'https://k@h/', 'nonsense']) {
    assert.equal(parseDsn(bad), null, bad);
  }
});

test('an event carries the error and request id, and nothing about the request or user', () => {
  const calls: { url: string; body: string }[] = [];
  const reporter = createSentryReporter({
    dsn: 'https://key@sentry.example/7',
    environment: 'staging',
    release: '1.2.3',
    logger,
    fetchImpl: ((url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as string });
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch,
  });
  const error = new Error('boom with a long message ' + 'x'.repeat(2000));
  reporter.capture(error, { requestId: 'req-1', where: 'http' });
  assert.equal(calls.length, 1);
  interface Sent {
    event_id: string;
    type?: string;
    environment?: string;
    release?: string;
    tags?: unknown;
    exception: { values: { value: string }[] };
  }
  const lines = calls[0]!.body.split('\n').map((l) => JSON.parse(l) as Sent);
  const header = lines[0]!;
  const item = lines[1]!;
  const event = lines[2]!;
  assert.equal(item.type, 'event');
  assert.equal(header.event_id, event.event_id);
  assert.equal(event.environment, 'staging');
  assert.equal(event.release, '1.2.3');
  assert.deepEqual(event.tags, { request_id: 'req-1' });
  assert.ok(event.exception.values[0]!.value.length <= 500);
  assert.deepEqual(Object.keys(event).sort(), [
    'environment',
    'event_id',
    'exception',
    'extra',
    'level',
    'platform',
    'release',
    'server_name',
    'tags',
    'timestamp',
  ]);
});

test('a flood is limited, a failing send never throws, and no DSN means nothing is sent', async () => {
  let sent = 0;
  let clock = new Date('2026-10-03T10:00:00Z');
  const reporter = createSentryReporter({
    dsn: 'https://key@sentry.example/7',
    environment: 'production',
    release: '1',
    logger,
    maxPerMinute: 3,
    now: () => clock,
    fetchImpl: () => {
      sent += 1;
      return Promise.reject(new Error('network down'));
    },
  });
  for (let i = 0; i < 10; i += 1) reporter.capture(new Error('x'));
  assert.equal(sent, 3);
  clock = new Date(clock.getTime() + 61_000);
  reporter.capture('a string, not an Error');
  assert.equal(sent, 4);
  await new Promise((r) => setImmediate(r));

  assert.equal(
    createSentryReporter({ dsn: 'bad', environment: 'x', release: '1', logger }),
    noopErrorReporter,
  );
  noopErrorReporter.capture(new Error('ignored'));
});
