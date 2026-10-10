import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { NeedsRelinkError } from '../../../src/domain/payout/errors.ts';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';
import { totpCode, totpCounter } from '../../../src/infrastructure/auth/totp.ts';

/**
 * Sign-up and provider onboarding end to end over HTTP, against a real
 * database, with `PAYOUT_PROVIDER=mock` and no other provider configuration.
 */

const suite = DATABASE_URL ? test : test.skip;
const PASSWORD = 'correct horse battery staple';
const PROFILE = {
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-04-12',
  countryOfResidence: 'GB',
  phone: '+447700900123',
};
const QUOTE = { sourceCurrency: 'GBP', targetCurrency: 'EUR', sourceAmount: '100.00' };

type Json = Record<string, unknown>;

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

function send(method: string, body: unknown, token?: string): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}
function get(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}
function data(res: { body: unknown }): Json {
  return (res.body as { data: Json }).data;
}
function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}
function errorFields(res: { body: unknown }): string[] {
  return (res.body as { error: { fieldErrors?: { field: string }[] } }).error.fieldErrors!.map(
    (e) => e.field,
  );
}

/** Registers over HTTP, verifies the email with a token we plant, and signs in. */
async function signUp(c: TestContext, email: string): Promise<{ token: string; userId: string }> {
  const registered = await c.http(
    '/api/v1/auth/register',
    send('POST', { email, password: PASSWORD }),
  );
  assert.equal(registered.status, 202);
  const { rows } = await c.container.pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  const userId = rows[0]!.id;
  // The real token only ever exists in the email, so plant one we know.
  const raw = randomBytes(24).toString('hex');
  await c.container.pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, now() + interval '1 hour')`,
    [userId, createHash('sha256').update(raw).digest('hex')],
  );
  const verified = await c.http('/api/v1/auth/email/verify', send('POST', { token: raw }));
  assert.equal(verified.status, 200);
  const login = await c.http('/api/v1/auth/login', send('POST', { email, password: PASSWORD }));
  assert.equal(login.status, 200);
  return { token: data(login).accessToken as string, userId };
}

/** Starts onboarding and returns the mock identity page's path on this test server. */
async function startOnboarding(c: TestContext, token: string): Promise<string> {
  const started = await c.http('/api/v1/onboarding/start', send('POST', {}, token));
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(data(started).kind, 'redirect');
  const url = new URL(data(started).url as string);
  assert.equal(url.pathname, '/dev/mock/kyc');
  return url.pathname + url.search;
}

/** Opens the mock identity page and returns the callback path for one outcome. */
async function callbackPath(c: TestContext, kycPath: string, outcome: string): Promise<string> {
  const page = await fetch(`${c.baseUrl}${kycPath}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  const link = links.find((l) => l.includes(`mock_outcome=${outcome}`));
  assert.ok(link, `no ${outcome} link on the mock page`);
  const url = new URL(link);
  return url.pathname + url.search;
}

async function kycStatus(c: TestContext, userId: string): Promise<string | undefined> {
  const { rows } = await c.container.pool.query<{ kyc_status: string }>(
    `SELECT kyc_status FROM provider_links WHERE user_id = $1 AND provider = 'mock'`,
    [userId],
  );
  return rows[0]?.kyc_status;
}

// --- The acceptance path ---------------------------------------------------------

suite('a new user signs up, verifies through the mock redirect and can then send', async () => {
  const { token, userId } = await signUp(ctx, 'new.customer@example.test');

  // Nothing is possible before the identity check.
  const early = await ctx.http('/api/v1/quotes', send('POST', QUOTE, token));
  assert.equal(early.status, 403);
  assert.equal(errorCode(early), 'CUSTOMER_NOT_VERIFIED');
  assert.deepEqual(data(await ctx.http('/api/v1/onboarding/status', get(token))), {
    status: 'UNVERIFIED',
    emailVerified: true,
    profileComplete: false,
  });

  const saved = await ctx.http('/api/v1/profile', send('PUT', PROFILE, token));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const kycPath = await startOnboarding(ctx, token);
  assert.equal(await kycStatus(ctx, userId), 'PENDING');
  assert.equal(data(await ctx.http('/api/v1/onboarding/status', get(token))).status, 'PENDING');
  assert.equal((await ctx.http('/api/v1/quotes', send('POST', QUOTE, token))).status, 403);

  // The customer's browser: provider page -> back to our callback. No bearer token.
  const callback = await fetch(`${ctx.baseUrl}${await callbackPath(ctx, kycPath, 'approved')}`);
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /return to the SomPay app/);

  assert.equal(await kycStatus(ctx, userId), 'VERIFIED');
  assert.equal(data(await ctx.http('/api/v1/onboarding/status', get(token))).status, 'VERIFIED');
  const quote = await ctx.http('/api/v1/quotes', send('POST', QUOTE, token));
  assert.equal(quote.status, 201, JSON.stringify(quote.body));

  const { rows } = await ctx.container.pool.query<{ action: string; actor_type: string }>(
    `SELECT action, actor_type FROM audit_events
     WHERE entity_id = $1 AND action LIKE 'customer.%' ORDER BY created_at, action`,
    [userId],
  );
  assert.deepEqual(
    rows.map((r) => `${r.actor_type}:${r.action}`).filter((r) => !r.includes('status_recorded')),
    ['user:customer.profile_updated', 'user:customer.onboarding_started'],
  );
  assert.ok(
    rows.some(
      (r) => r.action === 'customer.verification_status_recorded' && r.actor_type === 'provider',
    ),
  );
});

// --- Sign-up and profile validation ----------------------------------------------

suite('sign-up validates email and password and accepts no other fields', async () => {
  for (const [body, field] of [
    [{ email: 'not-an-email', password: PASSWORD }, 'body.email'],
    [{ email: 'ok@example.test', password: 'short' }, 'body.password'],
    [{ password: PASSWORD }, 'body.email'],
  ] as const) {
    const res = await ctx.http('/api/v1/auth/register', send('POST', body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(errorCode(res), 'VALIDATION_ERROR');
    assert.ok(errorFields(res).includes(field), field);
  }
  const extra = await ctx.http(
    '/api/v1/auth/register',
    send('POST', { email: 'ok@example.test', password: PASSWORD, kycStatus: 'VERIFIED' }),
  );
  assert.equal(extra.status, 400);
  assert.equal(await ctx.countRows('users'), 0);
});

suite('the profile step validates every field and needs a verified email', async () => {
  const { token, userId } = await signUp(ctx, 'profile@example.test');

  const bad = await ctx.http(
    '/api/v1/profile',
    send(
      'PUT',
      {
        firstName: '',
        lastName: '99',
        dateOfBirth: '2020-01-01',
        countryOfResidence: 'GB',
        phone: '0770',
      },
      token,
    ),
  );
  assert.equal(bad.status, 400);
  assert.deepEqual(errorFields(bad).sort(), [
    'body.dateOfBirth',
    'body.firstName',
    'body.lastName',
    'body.phone',
  ]);
  assert.equal(await ctx.countRows('users', `id = '${userId}' AND first_name IS NOT NULL`), 0);

  const unverified = await ctx.createUser({ emailVerified: false, providerVerified: false });
  const unverifiedToken = (
    await ctx.container.sessionService.startSession({
      userId: unverified.id,
      roles: ['customer'],
      emailVerified: false,
    })
  ).accessToken;
  const res = await ctx.http('/api/v1/profile', send('PUT', PROFILE, unverifiedToken));
  assert.equal(res.status, 403);
  assert.equal(errorCode(res), 'EMAIL_NOT_VERIFIED');
});

suite('a country the provider does not support is refused with a friendly message', async () => {
  const { token, userId } = await signUp(ctx, 'abroad@example.test');

  const listed = await ctx.http('/api/v1/profile', get(token));
  assert.deepEqual(data(listed).supportedCountries, ['GB']);

  const res = await ctx.http(
    '/api/v1/profile',
    send('PUT', { ...PROFILE, countryOfResidence: 'US' }, token),
  );
  assert.equal(res.status, 422);
  assert.equal(errorCode(res), 'COUNTRY_NOT_SUPPORTED');
  assert.match(
    (res.body as { error: { message: string } }).error.message,
    /can't offer transfers to people living in that country yet/,
  );
  assert.equal(await ctx.countRows('users', `id = '${userId}' AND first_name IS NOT NULL`), 0);
});

suite('the identity check cannot start before the profile is complete', async () => {
  const { token, userId } = await signUp(ctx, 'hasty@example.test');
  const res = await ctx.http('/api/v1/onboarding/start', send('POST', {}, token));
  assert.equal(res.status, 409);
  assert.equal(errorCode(res), 'PROFILE_INCOMPLETE');
  assert.equal(await kycStatus(ctx, userId), undefined);
});

// --- The verification status cannot be set by the user ---------------------------

suite('no request a customer can make sets their verification status', async () => {
  const { token, userId } = await signUp(ctx, 'sneaky@example.test');
  await ctx.http('/api/v1/profile', send('PUT', PROFILE, token));

  for (const [method, path, body] of [
    ['PUT', '/api/v1/profile', { ...PROFILE, kycStatus: 'VERIFIED' }],
    ['PUT', '/api/v1/profile', { ...PROFILE, status: 'VERIFIED' }],
    ['POST', '/api/v1/onboarding/start', { status: 'VERIFIED' }],
    ['POST', '/api/v1/onboarding/start', { kycStatus: 'VERIFIED' }],
  ] as const) {
    const res = await ctx.http(path, send(method, body, token));
    assert.equal(res.status, 400, `${method} ${path}`);
  }
  // There is no endpoint that writes the status directly.
  for (const [method, path] of [
    ['PUT', '/api/v1/onboarding/status'],
    ['POST', '/api/v1/onboarding/status'],
    ['PATCH', '/api/v1/onboarding/status'],
    ['POST', '/api/v1/onboarding/complete'],
  ] as const) {
    const res = await ctx.http(path, send(method, { status: 'VERIFIED' }, token));
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  assert.equal(await kycStatus(ctx, userId), undefined);
  assert.equal(data(await ctx.http('/api/v1/onboarding/status', get(token))).status, 'UNVERIFIED');
  assert.equal((await ctx.http('/api/v1/quotes', send('POST', QUOTE, token))).status, 403);
});

// --- The callback's CSRF state ---------------------------------------------------

suite('the callback is refused without the state we issued, and a state works once', async () => {
  const { token, userId } = await signUp(ctx, 'state@example.test');
  await ctx.http('/api/v1/profile', send('PUT', PROFILE, token));
  const kycPath = await startOnboarding(ctx, token);
  const good = await callbackPath(ctx, kycPath, 'approved');

  for (const path of [
    '/api/v1/onboarding/callback',
    '/api/v1/onboarding/callback?mock_outcome=approved',
    '/api/v1/onboarding/callback?state=&mock_outcome=approved',
    '/api/v1/onboarding/callback?state=guessed-by-an-attacker&mock_outcome=approved',
    // A bearer token is no substitute for the state.
  ]) {
    const res = await fetch(`${ctx.baseUrl}${path}`, get(token));
    assert.equal(res.status, 400, path);
    assert.match(await res.text(), /no longer valid/);
  }
  assert.equal(await kycStatus(ctx, userId), 'PENDING');

  // Only the hash is stored.
  const state = new URL(good, ctx.baseUrl).searchParams.get('state')!;
  assert.equal(await ctx.countRows('onboarding_states', `state_hash = '${state}'`), 0);
  assert.equal(
    await ctx.countRows(
      'onboarding_states',
      `state_hash = '${createHash('sha256').update(state).digest('hex')}' AND used_at IS NULL`,
    ),
    1,
  );

  assert.equal((await fetch(`${ctx.baseUrl}${good}`)).status, 200);
  assert.equal(await kycStatus(ctx, userId), 'VERIFIED');
  // Replaying the same link does nothing.
  assert.equal((await fetch(`${ctx.baseUrl}${good}`)).status, 400);
});

suite('an expired state is refused', async () => {
  const { token, userId } = await signUp(ctx, 'slow@example.test');
  await ctx.http('/api/v1/profile', send('PUT', PROFILE, token));
  const good = await callbackPath(ctx, await startOnboarding(ctx, token), 'approved');
  await ctx.container.pool.query(
    `UPDATE onboarding_states SET expires_at = now() - interval '1 minute'`,
  );
  assert.equal((await fetch(`${ctx.baseUrl}${good}`)).status, 400);
  assert.equal(await kycStatus(ctx, userId), 'PENDING');
});

suite('the mock identity page only ever links back to our own callback', async () => {
  for (const returnUrl of [
    'https://evil.example/api/v1/onboarding/callback?state=x',
    `${ctx.container.config.publicApiUrl}/api/v1/auth/logout-all`,
    'javascript:alert(1)',
    '',
  ]) {
    const res = await fetch(
      `${ctx.baseUrl}/dev/mock/kyc?return_url=${encodeURIComponent(returnUrl)}`,
    );
    assert.equal(res.status, 400, returnUrl);
  }
});

// --- Provider decisions other than "verified" ------------------------------------

suite('pending and rejected outcomes are stored as the provider reports them', async () => {
  for (const [outcome, status] of [
    ['pending', 'PENDING'],
    ['rejected', 'REJECTED'],
  ] as const) {
    const { token, userId } = await signUp(ctx, `${outcome}@example.test`);
    await ctx.http('/api/v1/profile', send('PUT', PROFILE, token));
    const path = await callbackPath(ctx, await startOnboarding(ctx, token), outcome);
    assert.equal((await fetch(`${ctx.baseUrl}${path}`)).status, 200);
    assert.equal(await kycStatus(ctx, userId), status);
    const quote = await ctx.http('/api/v1/quotes', send('POST', QUOTE, token));
    assert.equal(quote.status, 403);
    assert.equal(errorCode(quote), 'CUSTOMER_NOT_VERIFIED');
  }
});

suite(
  'an identity mismatch is held for review, alerts an admin and is never verified',
  async () => {
    const { token, userId } = await signUp(ctx, 'jane+mismatch@example.test');
    await ctx.http('/api/v1/profile', send('PUT', PROFILE, token));
    const path = await callbackPath(ctx, await startOnboarding(ctx, token), 'approved');
    ctx.logLines.length = 0;
    assert.equal((await fetch(`${ctx.baseUrl}${path}`)).status, 200);

    assert.equal(await kycStatus(ctx, userId), 'REJECTED_PENDING_REVIEW');
    const alert = ctx.logLines.find((l) => l.includes('admin.alert.identity_mismatch'));
    assert.ok(alert, 'an admin alert is logged');
    assert.ok(!alert.includes('1990-04-12') && !alert.includes('1901-01-01'));
    assert.equal(
      await ctx.countRows(
        'audit_events',
        `action = 'customer.identity_mismatch' AND entity_id = '${userId}'`,
      ),
      1,
    );

    // The provider says VERIFIED, but nothing the customer does lifts the hold.
    assert.equal(
      data(await ctx.http('/api/v1/onboarding/status', get(token))).status,
      'REJECTED_PENDING_REVIEW',
    );
    assert.deepEqual(data(await ctx.http('/api/v1/onboarding/start', send('POST', {}, token))), {
      kind: 'done',
      status: 'REJECTED_PENDING_REVIEW',
    });
    assert.equal(await kycStatus(ctx, userId), 'REJECTED_PENDING_REVIEW');
    const quote = await ctx.http('/api/v1/quotes', send('POST', QUOTE, token));
    assert.equal(quote.status, 403);
    assert.equal(errorCode(quote), 'CUSTOMER_NOT_VERIFIED');
  },
);

// --- Sending is impossible unless VERIFIED ---------------------------------------

suite('every money endpoint returns 403 for any status other than VERIFIED', async () => {
  const zero = '00000000-0000-4000-8000-000000000000';
  for (const [status, code] of [
    [undefined, 'CUSTOMER_NOT_VERIFIED'],
    ['PENDING', 'CUSTOMER_NOT_VERIFIED'],
    ['REJECTED', 'CUSTOMER_NOT_VERIFIED'],
    ['REJECTED_PENDING_REVIEW', 'CUSTOMER_NOT_VERIFIED'],
    ['NEEDS_RELINK', 'NEEDS_RELINK'],
  ] as const) {
    const user = await ctx.createUser({
      providerVerified: false,
      ...(status ? { kycStatus: status } : {}),
    });
    const token = await ctx.issueToken(user.id);
    for (const [path, body, headers] of [
      ['/api/v1/quotes', QUOTE, {}],
      ['/api/v1/recipients', { currency: 'EUR', country: 'DE', values: {} }, {}],
      [
        '/api/v1/transfers',
        { quoteId: zero, recipientId: zero },
        { 'idempotency-key': '00000000-0000-4000-8000-000000000042' },
      ],
    ] as const) {
      const init = send('POST', body, token);
      const res = await ctx.http(path, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), ...headers },
      });
      assert.equal(res.status, 403, `${status ?? 'no link'} ${path}`);
      assert.equal(errorCode(res), code, `${status ?? 'no link'} ${path}`);
    }
  }
  assert.equal(await ctx.countRows('transfers'), 0);
});

suite(
  'when the provider stops accepting the customer tokens, the link needs a relink and sending stops',
  async () => {
    const mock = new MockPayoutProvider({ clock: () => new Date() });
    let calls = 0;
    mock.createQuote = () => {
      calls += 1;
      return Promise.reject(new NeedsRelinkError());
    };
    const broken = await startTestContext({ payoutProvider: mock });
    try {
      await broken.reset();
      const user = await broken.createUser();
      const token = await broken.issueToken(user.id);

      const first = await broken.http('/api/v1/quotes', send('POST', QUOTE, token));
      assert.equal(first.status, 403);
      assert.equal(errorCode(first), 'NEEDS_RELINK');
      assert.equal(await kycStatus(broken, user.id), 'NEEDS_RELINK');
      assert.equal(calls, 1);

      // Blocked at the gate from now on: the provider is not called again.
      const second = await broken.http('/api/v1/quotes', send('POST', QUOTE, token));
      assert.equal(second.status, 403);
      assert.equal(errorCode(second), 'NEEDS_RELINK');
      assert.equal(calls, 1);

      // Reconnecting goes through the provider again; only its answer restores VERIFIED.
      const path = await callbackPath(broken, await startOnboarding(broken, token), 'approved');
      assert.equal((await fetch(`${broken.baseUrl}${path}`)).status, 200);
      assert.equal(await kycStatus(broken, user.id), 'VERIFIED');
    } finally {
      await broken.close();
    }
  },
);

// --- Two-step sign-in --------------------------------------------------------------

suite('optional two-step sign-in: set up, enable, then login needs a code', async () => {
  const secure = await startTestContext({
    envOverrides: { ENCRYPTION_KEY: randomBytes(32).toString('base64') },
  });
  try {
    await secure.reset();
    const email = 'twostep@example.test';
    const { token, userId } = await signUp(secure, email);

    const setup = await secure.http(
      '/api/v1/auth/2fa/setup',
      send('POST', { password: PASSWORD }, token),
    );
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    const secret = data(setup).secret as string;
    assert.match(data(setup).otpauthUri as string, /^otpauth:\/\/totp\/SomPay/);

    // Encrypted at rest; not yet required.
    const { rows } = await secure.container.pool.query<{ totp_secret_encrypted: string }>(
      `SELECT totp_secret_encrypted FROM user_auth WHERE user_id = $1`,
      [userId],
    );
    assert.ok(rows[0]!.totp_secret_encrypted);
    assert.ok(!rows[0]!.totp_secret_encrypted.includes(secret));
    const login = (body: Json) => secure.http('/api/v1/auth/login', send('POST', body));
    assert.equal((await login({ email, password: PASSWORD })).status, 200);

    const wrong = await secure.http(
      '/api/v1/auth/2fa/enable',
      send('POST', { code: '000000' }, token),
    );
    assert.equal(wrong.status, 400);
    const now = totpCounter(new Date());
    const enabled = await secure.http(
      '/api/v1/auth/2fa/enable',
      send('POST', { code: totpCode(secret, now - 1) }, token),
    );
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));

    const missing = await login({ email, password: PASSWORD });
    assert.equal(missing.status, 401);
    assert.equal(errorCode(missing), 'TOTP_REQUIRED');
    const bad = await login({ email, password: PASSWORD, totpCode: '000000' });
    assert.equal(bad.status, 401);
    assert.notEqual(errorCode(bad), 'TOTP_REQUIRED');
    // A wrong password never reveals that a code is needed.
    const wrongPassword = await login({ email, password: 'not the right password' });
    assert.notEqual(errorCode(wrongPassword), 'TOTP_REQUIRED');

    const code = totpCode(secret, now);
    assert.equal((await login({ email, password: PASSWORD, totpCode: code })).status, 200);
    // The same code cannot be used again.
    assert.equal((await login({ email, password: PASSWORD, totpCode: code })).status, 401);
  } finally {
    await secure.close();
  }
});

suite('two-step sign-in is refused when secrets cannot be encrypted', async () => {
  const { token } = await signUp(ctx, 'nokey@example.test');
  const setup = await ctx.http(
    '/api/v1/auth/2fa/setup',
    send('POST', { password: PASSWORD }, token),
  );
  assert.equal(setup.status, 503);
  assert.equal(errorCode(setup), 'TOTP_UNAVAILABLE');
});

suite('two-step sign-in needs the password again to be set up or turned off', async () => {
  const secure = await startTestContext({
    envOverrides: { ENCRYPTION_KEY: randomBytes(32).toString('base64') },
  });
  try {
    await secure.reset();
    const { token } = await signUp(secure, 'reauth@example.test');

    // A stolen access token alone is not enough.
    for (const body of [{}, { password: 'not the right password' }]) {
      const res = await secure.http('/api/v1/auth/2fa/setup', send('POST', body, token));
      assert.ok(res.status === 400 || res.status === 401, JSON.stringify(res.body));
    }
    assert.equal(await secure.countRows('user_auth', 'totp_secret_encrypted IS NOT NULL'), 0);

    const setup = await secure.http(
      '/api/v1/auth/2fa/setup',
      send('POST', { password: PASSWORD }, token),
    );
    assert.equal(setup.status, 200);
    const secret = data(setup).secret as string;
    const code = totpCode(secret, totpCounter(new Date()));
    assert.equal(
      (await secure.http('/api/v1/auth/2fa/enable', send('POST', { code }, token))).status,
      200,
    );

    const next = totpCode(secret, totpCounter(new Date()) + 1);
    const noPassword = await secure.http(
      '/api/v1/auth/2fa/disable',
      send('POST', { code: next }, token),
    );
    assert.equal(noPassword.status, 400);
    const wrong = await secure.http(
      '/api/v1/auth/2fa/disable',
      send('POST', { code: next, password: 'not the right password' }, token),
    );
    assert.equal(wrong.status, 401);
    assert.equal(await secure.countRows('user_auth', 'totp_enabled_at IS NOT NULL'), 1);
  } finally {
    await secure.close();
  }
});

suite('sign-up is rate limited', async () => {
  const limited = await startTestContext({ envOverrides: { AUTH_RATE_LIMIT_MAX: '3' } });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await limited.http(
        '/api/v1/auth/register',
        send('POST', { email: `rl${i}@example.test`, password: PASSWORD }),
      );
      codes.push(res.status);
    }
    assert.deepEqual(codes, [202, 202, 202, 429, 429]);
  } finally {
    await limited.close();
    await ctx.reset();
  }
});
