import test from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext } from '../support/harness.ts';

const suite = DATABASE_URL ? test : test.skip;

const login = (baseUrl: string): Promise<Response> =>
  fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.test', password: 'wrong password entirely' }),
  });

suite('rate limits are shared by every app instance (counted in Postgres)', async () => {
  const limits = { AUTH_RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' };
  const a = await startTestContext({ envOverrides: limits });
  const b = await startTestContext({ envOverrides: limits });
  try {
    await a.container.pool.query('TRUNCATE rate_limit_hits');
    // Two requests through instance A, one through B: the third counts against the same limit.
    assert.notEqual((await login(a.baseUrl)).status, 429);
    assert.notEqual((await login(a.baseUrl)).status, 429);
    assert.notEqual((await login(b.baseUrl)).status, 429);
    assert.equal((await login(b.baseUrl)).status, 429, 'the 4th request is limited on B');
    assert.equal((await login(a.baseUrl)).status, 429, 'and on A, which never saw it');
    const { rows } = await a.container.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rate_limit_hits`,
    );
    assert.ok(Number(rows[0]?.n) >= 1);
  } finally {
    await a.close();
    await b.close();
  }
});

suite('with RATE_LIMIT_STORE=memory the count stays per process', async () => {
  const limits = { AUTH_RATE_LIMIT_MAX: '2', RATE_LIMIT_STORE: 'memory' };
  const a = await startTestContext({ envOverrides: limits });
  const b = await startTestContext({ envOverrides: limits });
  try {
    await login(a.baseUrl);
    await login(a.baseUrl);
    assert.equal((await login(a.baseUrl)).status, 429);
    assert.notEqual((await login(b.baseUrl)).status, 429, 'B has its own count');
  } finally {
    await a.close();
    await b.close();
  }
});

suite('provider webhooks have their own, larger budget', async () => {
  const ctx = await startTestContext({ envOverrides: { RATE_LIMIT_MAX: '5' } });
  try {
    await ctx.container.pool.query('TRUNCATE rate_limit_hits');
    // 20 hits on the webhook path (unsigned, so refused) are not throttled at 5.
    let limited = 0;
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${ctx.baseUrl}/webhooks/mock`, { method: 'POST', body: '{}' });
      if (res.status === 429) limited += 1;
    }
    assert.equal(limited, 0);
  } finally {
    await ctx.close();
  }
});
