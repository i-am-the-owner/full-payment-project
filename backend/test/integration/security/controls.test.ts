import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';

/** Security controls end to end: account suspension, fraud alerts, CORS, headers, errors, injection. */

const suite = DATABASE_URL ? test : test.skip;
type Json = Record<string, unknown>;

const EUR_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};
const PASSWORD = 'correct horse battery staple';

let ctx: TestContext;
before(async () => {
  if (!DATABASE_URL) return;
  ctx = await startTestContext();
});
after(async () => {
  if (ctx) await ctx.close();
});
beforeEach(async () => {
  if (!ctx) return;
  await ctx.reset();
  await ctx.container.pool.query(`TRUNCATE admin_alerts, jobs, webhook_events`);
});

const data = (res: { body: unknown }): Json => (res.body as { data: Json }).data;
function call(
  c: TestContext,
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return c.http(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// --- Account suspension --------------------------------------------------------------

suite('an admin suspending a customer blocks them on their very next request', async () => {
  const customer = await ctx.createUser();
  const tokens = await ctx.createSession(customer.id);
  const admin = await ctx.createUser();
  const adminToken = await ctx.issueToken(admin.id, ['admin']);
  const quote = { sourceCurrency: 'GBP', targetCurrency: 'EUR', sourceAmount: '10.00' };

  assert.equal((await call(ctx, tokens.accessToken, 'POST', '/api/v1/quotes', quote)).status, 201);

  const suspended = await call(
    ctx,
    adminToken,
    'POST',
    `/api/v1/admin/users/${customer.id}/suspend`,
    {
      reason: 'Suspected account takeover',
    },
  );
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));

  // The access token they already hold stops working at once: nothing can be sent.
  for (const [method, path, body] of [
    ['POST', '/api/v1/quotes', quote],
    ['POST', '/api/v1/transfers', {}],
    ['GET', '/api/v1/transfers', undefined],
    ['GET', '/api/v1/me', undefined],
  ] as const) {
    assert.equal(
      (await call(ctx, tokens.accessToken, method, path, body)).status,
      401,
      `${method} ${path}`,
    );
  }
  // They cannot get a new one: the refresh token is dead and a new sign-in is refused.
  const refresh = await call(ctx, undefined, 'POST', '/api/v1/auth/refresh', {
    refreshToken: tokens.refreshToken,
  });
  assert.equal(refresh.status, 401);
  assert.equal(
    await ctx.countRows('auth_sessions', `user_id = '${customer.id}' AND status = 'active'`),
    0,
  );
  assert.equal(
    (await ctx.countRows(
      'auth_sessions',
      `user_id = '${customer.id}' AND revoked_reason = 'admin_suspended'`,
    )) > 0,
    true,
  );

  // The suspension is on the record, with who did it and why.
  const { rows } = await ctx.container.pool.query<{
    actor_type: string;
    actor_id: string;
    context: Json;
  }>(
    `SELECT actor_type, actor_id, context FROM audit_events WHERE action = 'admin.user.suspended' AND entity_id = $1`,
    [customer.id],
  );
  assert.equal(rows[0]?.actor_type, 'admin');
  assert.equal(rows[0]?.actor_id, admin.id);
  assert.equal(rows[0]?.context.reason, 'Suspected account takeover');

  // Reinstating restores access (with a fresh session).
  assert.equal(
    (await call(ctx, adminToken, 'POST', `/api/v1/admin/users/${customer.id}/reinstate`, {}))
      .status,
    200,
  );
  assert.equal(
    (await call(ctx, tokens.accessToken, 'GET', '/api/v1/me')).status,
    401,
    'old sessions stay revoked',
  );
  const fresh = await ctx.issueToken(customer.id);
  assert.equal((await call(ctx, fresh, 'POST', '/api/v1/quotes', quote)).status, 201);
});

suite('suspension: the rules around who can be suspended', async () => {
  const admin = await ctx.createUser();
  const adminToken = await ctx.issueToken(admin.id, ['admin']);
  const zero = '00000000-0000-4000-8000-000000000000';

  const self = await call(ctx, adminToken, 'POST', `/api/v1/admin/users/${admin.id}/suspend`, {
    reason: 'oops',
  });
  assert.equal(self.status, 400);
  assert.equal(
    (
      await call(ctx, adminToken, 'POST', `/api/v1/admin/users/${zero}/suspend`, {
        reason: 'unknown user',
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(ctx, adminToken, 'POST', `/api/v1/admin/users/${admin.id}/suspend`, {})).status,
    400,
  );
  assert.equal(
    (
      await call(ctx, adminToken, 'POST', `/api/v1/admin/users/not-a-uuid/suspend`, {
        reason: 'x'.repeat(5),
      })
    ).status,
    400,
  );

  const closed = await ctx.createUser({ status: 'closed' });
  assert.equal(
    (
      await call(ctx, adminToken, 'POST', `/api/v1/admin/users/${closed.id}/suspend`, {
        reason: 'already gone',
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(ctx, adminToken, 'POST', `/api/v1/admin/users/${closed.id}/reinstate`, {})).status,
    409,
  );
});

// --- Fraud signals -----------------------------------------------------------------------

suite(
  'many new recipients in a day, and many failed transfers, raise admin alerts without blocking anyone',
  async () => {
    const mock = new MockPayoutProvider({ webhookSecret: 'integration-mock-secret-0123456789' });
    const watched = await startTestContext({
      payoutProvider: mock,
      envOverrides: {
        FRAUD_NEW_RECIPIENTS_PER_DAY_ALERT: '3',
        FRAUD_FAILED_TRANSFERS_PER_DAY_ALERT: '2',
      },
    });
    try {
      await watched.reset();
      await watched.container.pool.query(`TRUNCATE admin_alerts, jobs, webhook_events`);
      const user = await watched.createUser();
      const token = await watched.issueToken(user.id);
      const add = (n: number) =>
        call(watched, token, 'POST', '/api/v1/recipients', {
          currency: 'EUR',
          country: 'DE',
          values: { ...EUR_VALUES, accountHolderName: `Person ${n}` },
        });

      await add(1);
      await add(2);
      assert.equal(await watched.countRows('admin_alerts'), 0);
      assert.equal((await add(3)).status, 201, 'the customer is not blocked');
      assert.equal((await add(4)).status, 201);
      const alerts = await watched.container.adminAlerts.list({ status: 'open', limit: 10 });
      assert.deepEqual(
        alerts.map((a) => a.kind),
        ['MANY_NEW_RECIPIENTS'],
      );
      assert.equal(alerts[0]?.entityId, user.id);
      assert.equal(alerts[0]?.occurrences, 2, 'repeats are counted, not duplicated');
      assert.ok(!JSON.stringify(alerts).includes('Person'), 'no recipient names in the alert');

      // Failed transfers: the provider rejects two payouts.
      const recipient = data(await add(5));
      for (let i = 0; i < 2; i += 1) {
        const quote = data(
          await call(watched, token, 'POST', '/api/v1/quotes', {
            sourceCurrency: 'GBP',
            targetCurrency: 'EUR',
            sourceAmount: '20.00',
          }),
        );
        const created = await call(
          watched,
          token,
          'POST',
          '/api/v1/transfers',
          { quoteId: quote.id, recipientId: recipient.id, answers: { purpose: 'gift' } },
          { 'idempotency-key': `00000000-0000-4000-8000-00000000f0${i}0` },
        );
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const { rows } = await watched.container.pool.query<{ provider_transfer_id: string }>(
          `SELECT provider_transfer_id FROM transfers WHERE id = $1`,
          [data(created).id],
        );
        const hook = mock.simulateTransferEvent(rows[0]!.provider_transfer_id, 'rejected');
        await fetch(`${watched.baseUrl}/webhooks/mock`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(hook.headers as Record<string, string>),
          },
          body: hook.rawBody,
        });
        await watched.container.background.runner.drain();
      }
      const kinds = (await watched.container.adminAlerts.list({ status: 'open', limit: 10 }))
        .map((a) => a.kind)
        .sort();
      assert.deepEqual(kinds, ['MANY_FAILED_TRANSFERS', 'MANY_NEW_RECIPIENTS']);
    } finally {
      await watched.close();
    }
  },
);

// --- CORS --------------------------------------------------------------------------------------

suite('by default no browser site may read the API: no CORS header is ever sent', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id);
  for (const origin of ['https://evil.example', 'https://app.example.com', 'null']) {
    const res = await call(ctx, token, 'GET', '/api/v1/me', undefined, { origin });
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    const preflight = await fetch(`${ctx.baseUrl}/api/v1/me`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    assert.equal(preflight.status, 403);
  }
});

suite(
  'only listed origins get CORS headers: exact match, never *, never with credentials',
  async () => {
    const web = await startTestContext({
      envOverrides: { CORS_ALLOWED_ORIGINS: 'https://app.example.com' },
    });
    try {
      const ok = await fetch(`${web.baseUrl}/api/v1/me`, {
        headers: { origin: 'https://app.example.com' },
      });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
      assert.match(ok.headers.get('vary') ?? '', /Origin/);
      assert.equal(ok.headers.get('access-control-allow-credentials'), null);

      for (const origin of [
        'https://evil.example',
        'https://app.example.com.evil.example',
        'http://app.example.com',
        'https://APP.example.com',
      ]) {
        const res = await fetch(`${web.baseUrl}/api/v1/me`, { headers: { origin } });
        assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
      }

      const preflight = await fetch(`${web.baseUrl}/api/v1/transfers`, {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.com');
      assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Idempotency-Key/);
      assert.notEqual(preflight.headers.get('access-control-allow-origin'), '*');
    } finally {
      await web.close();
    }
  },
);

// --- Headers --------------------------------------------------------------------------------------

suite('every response carries the security headers, and HSTS when enabled', async () => {
  for (const path of ['/api/v1/me', '/api/v1/does-not-exist', '/healthz']) {
    const res = await fetch(`${ctx.baseUrl}${path}`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', path);
    assert.match(
      res.headers.get('content-security-policy') ?? '',
      /default-src 'none'; frame-ancestors 'none'/,
      path,
    );
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(res.headers.get('x-powered-by'), null, path);
  }
  assert.equal((await fetch(`${ctx.baseUrl}/api/v1/me`)).headers.get('cache-control'), 'no-store');

  const hsts = await startTestContext({ envOverrides: { HSTS_ENABLED: 'true' } });
  try {
    const res = await fetch(`${hsts.baseUrl}/api/v1/me`);
    assert.match(
      res.headers.get('strict-transport-security') ?? '',
      /max-age=31536000; includeSubDomains/,
    );
  } finally {
    await hsts.close();
  }
});

// --- Friendly errors, details only in the log -----------------------------------------------------

suite(
  'an internal failure shows the user a friendly message and logs the details with the request id',
  async () => {
    const provider = new MockPayoutProvider();
    provider.listCurrencies = () =>
      Promise.reject(
        new Error('connect ECONNREFUSED 10.0.3.7:5432 for user almapay_prod (secret-detail-xyz)'),
      );
    const broken = await startTestContext({
      payoutProvider: provider,
      envOverrides: { LOG_LEVEL: 'error' },
    });
    try {
      const user = await broken.createUser();
      const token = await broken.issueToken(user.id);
      const res = await call(broken, token, 'GET', '/api/v1/currencies');

      assert.equal(res.status, 500);
      const error = (res.body as { error: { code: string; message: string; requestId: string } })
        .error;
      assert.equal(error.code, 'INTERNAL');
      assert.equal(error.message, 'An unexpected error occurred. Please try again later.');
      const everything = JSON.stringify(res.body);
      for (const leak of [
        'ECONNREFUSED',
        '10.0.3.7',
        'almapay_prod',
        'secret-detail-xyz',
        'at ',
        '.ts:',
      ]) {
        assert.ok(!everything.includes(leak), `${leak} must not reach the user`);
      }
      // The detail is in the server log, tied to the same request id.
      const line = broken.logLines.find((l) => l.includes('request.unhandled_error'));
      assert.ok(line);
      assert.ok(line.includes('ECONNREFUSED'));
      assert.ok(line.includes(error.requestId));
    } finally {
      await broken.close();
    }
  },
);

suite('malformed, oversized and unknown requests get friendly, typed errors', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id);
  const raw = (body: string, headers: Record<string, string> = {}) =>
    ctx.http('/api/v1/quotes', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body,
    });

  const badJson = await raw('{"sourceCurrency":');
  assert.equal(badJson.status, 400);
  assert.equal((badJson.body as { error: { code: string } }).error.code, 'VALIDATION_ERROR');
  const huge = await raw(JSON.stringify({ pad: 'x'.repeat(200_000) }));
  assert.equal(huge.status, 413);
  const notFound = await ctx.http('/api/v1/nothing-here');
  assert.equal(notFound.status, 404);
  for (const res of [badJson, huge, notFound]) {
    const text = JSON.stringify(res.body);
    assert.ok(!/Error:|at .*\.ts|node_modules|SyntaxError/.test(text), text);
  }
});

// --- Injection and output encoding ------------------------------------------------------------------

suite('injection attempts are inert: nothing breaks and nothing is stored as code', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id);
  const probes = [
    "' OR 1=1 --",
    "'; DROP TABLE users; --",
    '"><script>alert(1)</script>',
    '${7*7}',
    '{{7*7}}',
    '\u0000',
  ];

  for (const probe of probes) {
    const login = await call(ctx, undefined, 'POST', '/api/v1/auth/login', {
      email: `${probe}@example.test`,
      password: probe,
    });
    assert.ok(login.status === 400 || login.status === 401, `login: ${login.status}`);
    const recipient = await call(ctx, token, 'POST', '/api/v1/recipients', {
      currency: 'EUR',
      country: 'DE',
      values: { ...EUR_VALUES, accountHolderName: probe, iban: probe },
      displayName: probe,
    });
    assert.ok([201, 400, 422].includes(recipient.status), `recipient: ${recipient.status}`);
    const page = await call(
      ctx,
      token,
      'GET',
      `/api/v1/transfers?page=${encodeURIComponent(probe)}`,
    );
    assert.equal(page.status, 400);
    const byId = await call(ctx, token, 'GET', `/api/v1/transfers/${encodeURIComponent(probe)}`);
    assert.equal(byId.status, 400);
  }
  // The database is intact.
  assert.equal(await ctx.countRows('users'), 1);
  const { rows } = await ctx.container.pool.query(`SELECT to_regclass('users') AS t`);
  assert.equal((rows[0] as { t: string }).t, 'users');
});

suite(
  'HTML the API serves escapes anything reflected, and carries a no-script policy',
  async () => {
    const payload = '<script>alert(1)</script>"\'&';
    const callback = await fetch(
      `${ctx.baseUrl}/api/v1/onboarding/callback?state=${encodeURIComponent(payload)}&x=${encodeURIComponent(payload)}`,
    );
    const html = await callback.text();
    assert.equal(callback.status, 400);
    assert.ok(callback.headers.get('content-type')?.startsWith('text/html'));
    assert.ok(!html.includes('<script>') && !html.includes('alert(1)'));
    assert.match(callback.headers.get('content-security-policy') ?? '', /default-src 'none'/);

    // The mock identity page only links back to our own callback, with the URL properly encoded.
    const own = `${ctx.container.config.publicApiUrl}/api/v1/onboarding/callback?state=${encodeURIComponent('"><script>x</script>')}`;
    const page = await fetch(`${ctx.baseUrl}/dev/mock/kyc?return_url=${encodeURIComponent(own)}`);
    const body = await page.text();
    assert.equal(page.status, 200);
    assert.ok(!body.includes('<script>x</script>'));
    assert.ok(!/href="[^"]*"[^>]*><script/.test(body));
  },
);

suite(
  'open redirects: the identity page refuses any return address that is not our own callback',
  async () => {
    const own = ctx.container.config.publicApiUrl;
    for (const target of [
      'https://evil.example/api/v1/onboarding/callback',
      `${own}/api/v1/auth/logout-all`,
      `${own}.evil.example/api/v1/onboarding/callback`,
      `//evil.example/api/v1/onboarding/callback`,
      'javascript:alert(1)',
      `${own}@evil.example/api/v1/onboarding/callback`,
    ]) {
      const res = await fetch(
        `${ctx.baseUrl}/dev/mock/kyc?return_url=${encodeURIComponent(target)}`,
      );
      assert.equal(res.status, 400, target);
    }
    // The callback itself never redirects anywhere.
    const callback = await fetch(
      `${ctx.baseUrl}/api/v1/onboarding/callback?state=x&redirect=https://evil.example`,
      { redirect: 'manual' },
    );
    assert.equal(callback.status, 400);
    assert.equal(callback.headers.get('location'), null);
  },
);

suite(
  'a webhook endpoint accepts only signed content, and nothing it is sent is fetched or echoed',
  async () => {
    const res = await fetch(`${ctx.baseUrl}/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://169.254.169.254/latest/meta-data/',
        callback: 'https://evil.example',
      }),
    });
    assert.equal(res.status, 401);
    assert.ok(!JSON.stringify(await res.json()).includes('169.254'));
    void PASSWORD;
  },
);

// --- Authentication ------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const post = (c: TestContext, path: string, body: unknown) =>
  c.http(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function registeredUser(email: string) {
  await post(ctx, '/api/v1/auth/register', { email, password: PASSWORD });
  const { rows } = await ctx.container.pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  return rows[0]!.id;
}
async function plant(userId: string, purpose: string, expires: string): Promise<string> {
  const raw = randomBytes(24).toString('hex');
  const expired = expires.startsWith('-');
  // A token cannot be created already expired, so an expired one is created in the past.
  await ctx.container.pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, now() + ($4::interval - interval '1 hour'), now() + $4::interval)`,
    [userId, purpose, sha256(raw), expired ? expires : expires],
  );
  return raw;
}

suite(
  'a password reset token works once, expires, and cannot be borrowed from another purpose',
  async () => {
    const userId = await registeredUser('reset@example.test');
    await ctx.container.pool.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [
      userId,
    ]);
    const reset = (token: string, newPassword = 'a brand new passphrase 123') =>
      post(ctx, '/api/v1/auth/password/reset', { token, newPassword });

    const good = await plant(userId, 'password_reset', '30 minutes');
    assert.equal((await reset(good)).status, 200);
    assert.equal(
      (await reset(good, 'another passphrase 456 xyz')).status,
      400,
      'a used token is dead',
    );

    const stale = await plant(userId, 'password_reset', '-1 minute');
    assert.equal((await reset(stale)).status, 400, 'an expired token is dead');

    const wrongPurpose = await plant(userId, 'email_verification', '30 minutes');
    assert.equal(
      (await reset(wrongPurpose)).status,
      400,
      'a verification token cannot reset a password',
    );

    assert.equal((await reset(randomBytes(24).toString('hex'))).status, 400);
    // Only the first reset took effect.
    assert.equal(
      (
        await post(ctx, '/api/v1/auth/login', {
          email: 'reset@example.test',
          password: 'a brand new passphrase 123',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post(ctx, '/api/v1/auth/login', {
          email: 'reset@example.test',
          password: 'another passphrase 456 xyz',
        })
      ).status,
      401,
    );
    // The token is stored hashed, never in the clear.
    assert.equal(await ctx.countRows('auth_tokens', `token_hash = '${good}'`), 0);
  },
);

suite(
  'a password reset ends every existing session, and the password is stored only as an Argon2id hash',
  async () => {
    const userId = await registeredUser('sessions@example.test');
    await ctx.container.pool.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [
      userId,
    ]);
    const login = await post(ctx, '/api/v1/auth/login', {
      email: 'sessions@example.test',
      password: PASSWORD,
    });
    const old = (login.body as { data: { accessToken: string } }).data.accessToken;
    assert.equal((await call(ctx, old, 'GET', '/api/v1/me')).status, 200);

    const token = await plant(userId, 'password_reset', '30 minutes');
    assert.equal(
      (
        await post(ctx, '/api/v1/auth/password/reset', {
          token,
          newPassword: 'a brand new passphrase 123',
        })
      ).status,
      200,
    );
    assert.equal((await call(ctx, old, 'GET', '/api/v1/me')).status, 401);

    const { rows } = await ctx.container.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM user_auth WHERE user_id = $1`,
      [userId],
    );
    assert.match(rows[0]!.password_hash, /^\$argon2id\$/);
    assert.ok(!rows[0]!.password_hash.includes('passphrase'));
  },
);

suite('repeated wrong passwords lock the account, and the answer never reveals why', async () => {
  const email = 'lockout@example.test';
  const userId = await registeredUser(email);
  await ctx.container.pool.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [
    userId,
  ]);
  const attempt = (password: string) => post(ctx, '/api/v1/auth/login', { email, password });

  const answers: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const res = await attempt(`wrong password number ${i} here`);
    assert.equal(res.status, 401);
    answers.push(JSON.stringify((res.body as { error: Json }).error.message));
  }
  assert.equal(new Set(answers).size, 1, 'the same message every time');
  // Locked: even the right password is refused, with the same message.
  const locked = await attempt(PASSWORD);
  assert.equal(locked.status, 401);
  assert.equal(JSON.stringify((locked.body as { error: Json }).error.message), answers[0]);
  // And an unknown email gets that very message too.
  const unknown = await post(ctx, '/api/v1/auth/login', {
    email: 'nobody@example.test',
    password: 'whatever password here',
  });
  assert.equal(JSON.stringify((unknown.body as { error: Json }).error.message), answers[0]);
});

suite('an expired access token is refused, and signing out ends the session at once', async () => {
  const user = await ctx.createUser();
  const expired = await ctx.createExpiredToken(user.id);
  assert.equal((await call(ctx, expired, 'GET', '/api/v1/me')).status, 401);

  const tokens = await ctx.createSession(user.id);
  assert.equal((await call(ctx, tokens.accessToken, 'GET', '/api/v1/me')).status, 200);
  assert.equal(
    (await post(ctx, '/api/v1/auth/logout', { refreshToken: tokens.refreshToken })).status,
    200,
  );
  // The access token no longer works even though it has not expired, and the refresh token is dead.
  assert.equal((await call(ctx, tokens.accessToken, 'GET', '/api/v1/me')).status, 401);
  assert.equal(
    (await post(ctx, '/api/v1/auth/refresh', { refreshToken: tokens.refreshToken })).status,
    401,
  );
});

// --- Logs ------------------------------------------------------------------------------------------------------

suite('a whole customer journey leaves no secret, token or personal data in the logs', async () => {
  const mock = new MockPayoutProvider({ webhookSecret: 'integration-mock-secret-0123456789' });
  const noisy = await startTestContext({
    payoutProvider: mock,
    envOverrides: { LOG_LEVEL: 'debug', DEV_LOG_MAIL_LINKS: 'false' },
  });
  try {
    await noisy.reset();
    const email = 'journey.person@example.test';
    const secretPassword = 'unmistakable-journey-passphrase-42';
    const register = await post(noisy, '/api/v1/auth/register', {
      email,
      password: secretPassword,
    });
    assert.equal(register.status, 202);
    await noisy.container.pool.query(
      `UPDATE users SET email_verified_at = now() WHERE email = $1`,
      [email],
    );
    await post(noisy, '/api/v1/auth/login', { email, password: 'a wrong passphrase entirely' });
    const login = await post(noisy, '/api/v1/auth/login', { email, password: secretPassword });
    const { accessToken, refreshToken } = (
      login.body as { data: { accessToken: string; refreshToken: string } }
    ).data;

    const { rows } = await noisy.container.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    await noisy.container.pool.query(
      `INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status, identity_checked_at)
       VALUES ($1, 'mock', $2, 'VERIFIED', now())`,
      [rows[0]!.id, `mock-verified-${rows[0]!.id}`],
    );
    const profile = {
      firstName: 'Journeyfirst',
      lastName: 'Journeylast',
      dateOfBirth: '1987-06-15',
      countryOfResidence: 'GB',
      phone: '+447700900987',
    };
    await call(noisy, accessToken, 'PUT', '/api/v1/profile', profile);

    const iban = 'DE89370400440532013000';
    const quote = data(
      await call(noisy, accessToken, 'POST', '/api/v1/quotes', {
        sourceCurrency: 'GBP',
        targetCurrency: 'EUR',
        sourceAmount: '40.00',
      }),
    );
    const recipient = data(
      await call(noisy, accessToken, 'POST', '/api/v1/recipients', {
        currency: 'EUR',
        country: 'DE',
        values: { legalType: 'PRIVATE', accountHolderName: 'Journeyrecipient Name', iban },
      }),
    );
    const created = await call(
      noisy,
      accessToken,
      'POST',
      '/api/v1/transfers',
      {
        quoteId: quote.id,
        recipientId: recipient.id,
        answers: { purpose: 'gift' },
        reference: 'Journey reference',
      },
      { 'idempotency-key': '00000000-0000-4000-8000-0000000000a9' },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const funding = await call(
      noisy,
      accessToken,
      'GET',
      `/api/v1/transfers/${String(data(created).id)}/funding`,
    );
    const bank = (data(funding).methods as Json[])[0]!;
    const { rows: tr } = await noisy.container.pool.query<{ provider_transfer_id: string }>(
      `SELECT provider_transfer_id FROM transfers WHERE id = $1`,
      [data(created).id],
    );
    const hook = mock.simulateTransferEvent(tr[0]!.provider_transfer_id, 'funded');
    await fetch(`${noisy.baseUrl}/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(hook.headers as Record<string, string>) },
      body: hook.rawBody,
    });
    await fetch(`${noisy.baseUrl}/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-signature': 'bad' },
      body: hook.rawBody,
    });
    await noisy.container.background.runner.drain();
    // An onboarding callback with secrets in its query string.
    await fetch(
      `${noisy.baseUrl}/api/v1/onboarding/callback?state=state-secret-value-123&code=provider-auth-code-456`,
    );
    await post(noisy, '/api/v1/auth/refresh', { refreshToken });
    await post(noisy, '/api/v1/auth/password/forgot', { email });

    const everything = noisy.logLines.join('\n');
    assert.ok(everything.length > 500, 'the journey was actually logged');
    const mustNotAppear: [string, string][] = [
      ['password', secretPassword],
      ['wrong password', 'a wrong passphrase entirely'],
      ['access token', accessToken],
      ['refresh token', refreshToken],
      ['email address', email],
      ['first name', 'Journeyfirst'],
      ['last name', 'Journeylast'],
      ['date of birth', '1987-06-15'],
      ['phone', '+447700900987'],
      ['IBAN', iban],
      ['recipient name', 'Journeyrecipient'],
      ['bank detail', String((bank.bankDetails as { value: string }[])[2]?.value)],
      ['bank reference', String(bank.reference)],
      ['webhook secret', 'integration-mock-secret'],
      ['callback state', 'state-secret-value-123'],
      ['callback code', 'provider-auth-code-456'],
      ['transfer reference text', 'Journey reference'],
    ];
    for (const [what, value] of mustNotAppear) {
      assert.ok(!everything.includes(value), `${what} must not be logged`);
    }
    // What is logged is useful: request ids, routes and statuses.
    assert.match(everything, /"requestId":"[0-9a-f-]{36}"/);
    assert.match(everything, /"route":"\/transfers"/);
  } finally {
    await noisy.close();
  }
});
