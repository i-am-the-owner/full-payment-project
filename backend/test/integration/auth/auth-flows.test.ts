import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const dataOf = (body: unknown): unknown => (body as { data: unknown }).data;

const suite = DATABASE_URL ? test : test.skip;

let ctx: TestContext;
const strongPassword = 'correct horse battery staple';

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

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function registerAndLogin(email: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  await ctx.http('/api/v1/auth/register', json({ email, password: strongPassword }));
  const login = await ctx.http('/api/v1/auth/login', json({ email, password: strongPassword }));
  assert.equal(login.status, 200);
  const data = (login.body as { data: { accessToken: string; refreshToken: string } }).data;
  return data;
}

suite('register returns an identical 202 for a new and an existing email', async () => {
  const first = await ctx.http(
    '/api/v1/auth/register',
    json({ email: 'dup@example.test', password: strongPassword }),
  );
  const second = await ctx.http(
    '/api/v1/auth/register',
    json({ email: 'dup@example.test', password: strongPassword }),
  );

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual(dataOf(first.body), dataOf(second.body));
  assert.equal(await ctx.countRows('users', `email = 'dup@example.test'`), 1);
});

suite('register rejects a weak password with field errors', async () => {
  const res = await ctx.http(
    '/api/v1/auth/register',
    json({ email: 'weak@example.test', password: 'short' }),
  );
  assert.equal(res.status, 400);
  const body = res.body as { error: { code: string; fieldErrors: { field: string }[] } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.fieldErrors[0]?.field, 'body.password');
});

suite('login → me → refresh → logout', async () => {
  const { accessToken, refreshToken } = await registerAndLogin('flow@example.test');

  const me = await ctx.http('/api/v1/me', { headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(me.status, 200);
  assert.equal((me.body as { data: { email: string } }).data.email, 'flow@example.test');

  const refreshed = await ctx.http('/api/v1/auth/refresh', json({ refreshToken }));
  assert.equal(refreshed.status, 200);
  const next = (refreshed.body as { data: { accessToken: string; refreshToken: string } }).data;
  assert.notEqual(next.refreshToken, refreshToken);

  const logout = await ctx.http('/api/v1/auth/logout', json({ refreshToken: next.refreshToken }));
  assert.equal(logout.status, 200);

  // The access token from the logged-out session is now rejected.
  const afterLogout = await ctx.http('/api/v1/me', {
    headers: { authorization: `Bearer ${next.accessToken}` },
  });
  assert.equal(afterLogout.status, 401);
});

suite('a wrong password is generic, and repeated failures lock the account', async () => {
  const email = 'lock@example.test';
  await ctx.http('/api/v1/auth/register', json({ email, password: strongPassword }));

  for (let i = 0; i < 5; i += 1) {
    const res = await ctx.http(
      '/api/v1/auth/login',
      json({ email, password: 'the wrong password' }),
    );
    assert.equal(res.status, 401);
    assert.equal(
      (res.body as { error: { message: string } }).error.message,
      'Invalid email or password.',
    );
  }

  // Correct password now, but the account is locked → still generic 401.
  const locked = await ctx.http('/api/v1/auth/login', json({ email, password: strongPassword }));
  assert.equal(locked.status, 401);

  const lockedUntil = await ctx.countRows(
    'user_auth',
    `locked_until IS NOT NULL AND locked_until > now()`,
  );
  assert.equal(lockedUntil, 1);
});

suite('replaying a rotated refresh token revokes the whole family', async () => {
  const { refreshToken } = await registerAndLogin('reuse@example.test');

  const rotated = await ctx.http('/api/v1/auth/refresh', json({ refreshToken }));
  assert.equal(rotated.status, 200);
  const successor = (rotated.body as { data: { refreshToken: string } }).data.refreshToken;

  // Replay the original (now rotated) token.
  const replay = await ctx.http('/api/v1/auth/refresh', json({ refreshToken }));
  assert.equal(replay.status, 401);

  // The legitimate successor is now dead too.
  const successorReplay = await ctx.http('/api/v1/auth/refresh', json({ refreshToken: successor }));
  assert.equal(successorReplay.status, 401);
});

suite('email verification flow', async () => {
  const email = 'verify@example.test';
  await ctx.http('/api/v1/auth/register', json({ email, password: strongPassword }));

  const { rows } = await ctx.container.pool.query<{ token_hash: string }>(
    `SELECT token_hash FROM auth_tokens WHERE purpose = 'email_verification'`,
  );
  assert.equal(rows.length, 1);

  // Reproduce the raw token by verifying: the harness cannot read the raw token,
  // so drive verification via a token we set directly.
  await ctx.container.pool.query(`DELETE FROM auth_tokens`);
  const raw = 'a-known-raw-verification-token-value';
  const hash = sha256(raw);
  const user = await ctx.container.pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  await ctx.container.pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, now() + interval '1 hour')`,
    [user.rows[0]!.id, hash],
  );

  const verify = await ctx.http('/api/v1/auth/email/verify', json({ token: raw }));
  assert.equal(verify.status, 200);
  assert.equal(
    await ctx.countRows('users', `email = '${email}' AND email_verified_at IS NOT NULL`),
    1,
  );

  // Single use.
  const again = await ctx.http('/api/v1/auth/email/verify', json({ token: raw }));
  assert.equal(again.status, 400);
});

suite('password reset sets a new password and revokes existing sessions', async () => {
  const email = 'reset@example.test';
  const { accessToken } = await registerAndLogin(email);

  await ctx.http('/api/v1/auth/password/forgot', json({ email }));
  const user = await ctx.container.pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  // Replace the issued reset token with a known one.
  await ctx.container.pool.query(
    `UPDATE auth_tokens SET consumed_at = now() WHERE purpose = 'password_reset'`,
  );
  const raw = 'a-known-raw-reset-token-value-here';
  const hash = sha256(raw);
  await ctx.container.pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`,
    [user.rows[0]!.id, hash],
  );

  const reset = await ctx.http(
    '/api/v1/auth/password/reset',
    json({ token: raw, newPassword: 'a completely different passphrase' }),
  );
  assert.equal(reset.status, 200);

  // Old session is dead.
  const me = await ctx.http('/api/v1/me', { headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(me.status, 401);

  // Old password no longer works; new one does.
  assert.equal(
    (await ctx.http('/api/v1/auth/login', json({ email, password: strongPassword }))).status,
    401,
  );
  assert.equal(
    (
      await ctx.http(
        '/api/v1/auth/login',
        json({ email, password: 'a completely different passphrase' }),
      )
    ).status,
    200,
  );
});

suite('forgot-password returns an identical 202 whether or not the email exists', async () => {
  const known = await ctx.http(
    '/api/v1/auth/password/forgot',
    json({ email: 'ghost@example.test' }),
  );
  await ctx.http(
    '/api/v1/auth/register',
    json({ email: 'real@example.test', password: strongPassword }),
  );
  const real = await ctx.http('/api/v1/auth/password/forgot', json({ email: 'real@example.test' }));

  assert.equal(known.status, 202);
  assert.equal(real.status, 202);
  assert.deepEqual(dataOf(known.body), dataOf(real.body));
});

suite('logout-all revokes every session for the user', async () => {
  const email = 'multi@example.test';
  await ctx.http('/api/v1/auth/register', json({ email, password: strongPassword }));

  async function loginToken(): Promise<string> {
    const res = await ctx.http('/api/v1/auth/login', json({ email, password: strongPassword }));
    return (res.body as { data: { accessToken: string } }).data.accessToken;
  }
  const tokenA = await loginToken();
  const tokenB = await loginToken();

  const logoutAll = await ctx.http('/api/v1/auth/logout-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
    body: '{}',
  });
  assert.equal(logoutAll.status, 200);

  for (const token of [tokenA, tokenB]) {
    assert.equal(
      (await ctx.http('/api/v1/me', { headers: { authorization: `Bearer ${token}` } })).status,
      401,
    );
  }
});

suite('no password value is ever written to the structured logs', async () => {
  const logged = await startTestContext({ envOverrides: { LOG_LEVEL: 'debug' } });
  const email = 'logs@example.test';
  const password = 'unmistakable-secret-passphrase-42';
  try {
    await logged.http('/api/v1/auth/register', json({ email, password }));
    await logged.http('/api/v1/auth/login', json({ email, password }));
    await logged.http('/api/v1/auth/login', json({ email, password: 'the wrong one entirely' }));
  } finally {
    await logged.close();
  }

  const output = logged.logLines.join('\n');
  assert.ok(output.length > 0, 'expected some log output');
  assert.doesNotMatch(output, /unmistakable-secret-passphrase-42/);
  assert.doesNotMatch(output, /the wrong one entirely/);
  assert.doesNotMatch(output, /"password"\s*:/);
});

suite('auth endpoints are rate limited', async () => {
  const limited = await startTestContext({ envOverrides: { AUTH_RATE_LIMIT_MAX: '3' } });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await limited.http(
        '/api/v1/auth/login',
        json({ email: 'rl@example.test', password: 'whatever password value' }),
      );
      codes.push(res.status);
    }
    assert.equal(codes.filter((c) => c === 429).length >= 1, true);
  } finally {
    await limited.close();
  }
});
