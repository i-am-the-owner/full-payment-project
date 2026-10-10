import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from './support/harness.ts';

const suite = DATABASE_URL ? test : test.skip;

let ctx: TestContext;

before(async () => {
  if (!DATABASE_URL) return;
  ctx = await startTestContext();
});

after(async () => {
  if (ctx) await ctx.close();
});

suite('GET /healthz returns a 200 liveness envelope', async () => {
  const { status, body } = await ctx.http('/healthz');
  assert.equal(status, 200);
  const payload = body as {
    data: { status: string; version: string };
    meta: { requestId: string };
  };
  assert.equal(payload.data.status, 'ok');
  assert.equal(typeof payload.data.version, 'string');
  assert.match(payload.meta.requestId, /.+/);
});

suite('GET /readyz reports the database as up', async () => {
  const { status, body } = await ctx.http('/readyz');
  assert.equal(status, 200);
  const payload = body as { data: { status: string; checks: { name: string; status: string }[] } };
  assert.equal(payload.data.status, 'ready');
  assert.equal(payload.data.checks[0]?.name, 'database');
  assert.equal(payload.data.checks[0]?.status, 'up');
});

suite('GET /readyz returns 503 when the database is unreachable', async () => {
  const brokenCtx = await startTestContext({
    envOverrides: { DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none' },
    skipMigrations: true,
  });
  try {
    const { status, body } = await brokenCtx.http('/readyz');
    assert.equal(status, 503);
    const payload = body as { error: { code: string; fieldErrors?: { field: string }[] } };
    assert.equal(payload.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(payload.error.fieldErrors?.[0]?.field, 'database');
  } finally {
    // Server socket only; the pool never connected.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await brokenCtx.close();
  }
});
