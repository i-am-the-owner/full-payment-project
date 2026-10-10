import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';

const suite = DATABASE_URL ? test : test.skip;

let ctx: TestContext;

before(async () => {
  if (!DATABASE_URL) return;
  ctx = await startTestContext();
});

after(async () => {
  if (ctx) await ctx.close();
});

beforeEach(async () => {
  if (ctx) await ctx.reset();
});

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    timestamp: string;
    fieldErrors?: unknown;
  };
}

suite('GET /api advertises the current API version', async () => {
  const { status, body } = await ctx.http('/api');
  assert.equal(status, 200);
  const payload = body as { data: { versions: { version: string; status: string }[] } };
  assert.deepEqual(payload.data.versions, [
    { version: 'v1', status: 'current', basePath: '/api/v1' },
  ]);
});

suite('every response carries security headers and a request id', async () => {
  const { headers } = await ctx.http('/api');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(
    headers.get('content-security-policy'),
    "default-src 'none'; frame-ancestors 'none'",
  );
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.match(headers.get('x-request-id') ?? '', /.+/);
  assert.equal(headers.get('x-powered-by'), null);
});

suite('an incoming x-request-id is echoed back', async () => {
  const { headers } = await ctx.http('/api', { headers: { 'x-request-id': 'trace-abc-123' } });
  assert.equal(headers.get('x-request-id'), 'trace-abc-123');
});

suite('unknown routes return a 404 error envelope', async () => {
  const { status, body } = await ctx.http('/api/v1/nope');
  assert.equal(status, 404);
  assert.equal((body as ErrorBody).error.code, 'NOT_FOUND');
  assert.match((body as ErrorBody).error.requestId, /.+/);
});

suite('GET /api/v1/me without a token is 401', async () => {
  const { status, body } = await ctx.http('/api/v1/me');
  assert.equal(status, 401);
  assert.equal((body as ErrorBody).error.code, 'UNAUTHORIZED');
});

suite('GET /api/v1/me with a malformed token is 401', async () => {
  const { status, body } = await ctx.http('/api/v1/me', {
    headers: { authorization: 'Bearer not.a.jwt' },
  });
  assert.equal(status, 401);
  assert.equal((body as ErrorBody).error.code, 'UNAUTHORIZED');
});

suite('GET /api/v1/me with an expired token is 401', async () => {
  const user = await ctx.createUser();
  const token = await ctx.createExpiredToken(user.id);
  const { status } = await ctx.http('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(status, 401);
});

suite('GET /api/v1/me with a valid token returns the account from the database', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id, ['customer']);

  const { status, body } = await ctx.http('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(status, 200);
  const payload = body as {
    data: { id: string; email: string; status: string; roles: string[] };
    meta: { requestId: string };
  };
  assert.equal(payload.data.id, user.id);
  assert.equal(payload.data.email, user.email);
  assert.equal(payload.data.status, 'active');
  assert.deepEqual(payload.data.roles, ['customer']);
});

suite('GET /api/v1/me after the session is revoked is 401', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id, ['customer']);
  // Deleting the user cascade-deletes the session.
  await ctx.container.pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);

  const { status } = await ctx.http('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(status, 401);
});

suite('a suspended account cannot use an authenticated endpoint', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id, ['customer']);
  await ctx.container.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [user.id]);

  const { status, body } = await ctx.http('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(status, 401);
  assert.equal((body as ErrorBody).error.code, 'UNAUTHORIZED');
});

suite('GET /api/v1/me rejects unexpected query parameters with 400', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id, ['customer']);
  const { status, body } = await ctx.http('/api/v1/me?inject=1', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(status, 400);
  assert.equal((body as ErrorBody).error.code, 'VALIDATION_ERROR');
});

suite('admin route: a customer token is forbidden, an admin token is allowed', async () => {
  const customer = await ctx.createUser();
  const admin = await ctx.createUser();

  const customerToken = await ctx.issueToken(customer.id, ['customer']);
  const adminToken = await ctx.issueToken(admin.id, ['admin']);

  const forbidden = await ctx.http('/api/v1/admin/whoami', {
    headers: { authorization: `Bearer ${customerToken}` },
  });
  assert.equal(forbidden.status, 403);
  assert.equal((forbidden.body as ErrorBody).error.code, 'FORBIDDEN');

  const allowed = await ctx.http('/api/v1/admin/whoami', {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(allowed.status, 200);
  assert.equal((allowed.body as { data: { userId: string } }).data.userId, admin.id);
});

suite('a large request body is rejected with 413', async () => {
  const { status, body } = await ctx.http('/api/v1/me', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
    body: JSON.stringify({ padding: 'a'.repeat(64 * 1024) }),
  });
  assert.equal(status, 413);
  assert.equal((body as ErrorBody).error.code, 'PAYLOAD_TOO_LARGE');
});

suite('the global rate limiter returns 429 once the limit is exceeded', async () => {
  const limitedCtx = await startTestContext({ envOverrides: { RATE_LIMIT_MAX: '3' } });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      codes.push((await limitedCtx.http('/api')).status);
    }
    assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);

    const limited = await limitedCtx.http('/api');
    assert.equal(limited.status, 429);
    assert.equal((limited.body as ErrorBody).error.code, 'RATE_LIMITED');
    assert.match(limited.headers.get('retry-after') ?? '', /^\d+$/);
  } finally {
    await limitedCtx.close();
  }
});
