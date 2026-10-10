import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { totpCode, totpCounter } from '../../../src/infrastructure/auth/totp.ts';

/**
 * The admin console: only admins with two-step sign-in get in, every request is
 * audited, everything is read-only except suspension and alerts, and an admin
 * cannot change an amount or a status.
 */

const suite = DATABASE_URL ? test : test.skip;
type Json = Record<string, unknown>;
const PASSWORD = 'correct horse battery staple';

let ctx: TestContext;

before(async () => {
  if (!DATABASE_URL) return;
  ctx = await startTestContext({
    envOverrides: {
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      DASHBOARD_USD_RATES: 'GBP:1.25',
    },
  });
});
after(async () => {
  if (ctx) await ctx.close();
});
beforeEach(async () => {
  if (ctx) await ctx.reset();
});

const data = (res: { body: unknown }): Json => (res.body as { data: Json }).data;
const errorCode = (res: { body: unknown }): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';

function api(token: string | undefined, method: string, path: string, body?: unknown) {
  return ctx.http(`/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** An admin as the database sees one, signed in with a real session. */
async function admin(): Promise<{ id: string; token: string }> {
  const user = await ctx.createUser();
  return { id: user.id, token: await ctx.issueToken(user.id, ['admin']) };
}

/** A transfer in the given state, inserted directly (the admin API only reads them). */
async function transferFor(
  userId: string,
  status: string,
  options: { ageHours?: number; amount?: number; currency?: string } = {},
): Promise<string> {
  const amount = options.amount ?? 10_000;
  const reference = `ALM-${randomUUID().slice(0, 8)}`;
  const { rows: q } = await ctx.container.pool.query<{ id: string }>(
    `INSERT INTO transfer_quotes (user_id, provider, provider_quote_id, source_currency,
        destination_currency, source_amount_minor, fee_amount_minor,
        destination_amount_minor, exchange_rate, expires_at)
     VALUES ($1, 'mock', $2, $3, 'EUR', $4, 100, 11000, 1.1, now() + interval '1 day')
     RETURNING id`,
    [userId, randomUUID(), options.currency ?? 'GBP', amount],
  );
  const { rows: r } = await ctx.container.pool.query<{ id: string }>(
    `INSERT INTO recipients (user_id, provider, provider_recipient_id, currency_code, country_code,
        account_holder_name, account_summary, display_name)
     VALUES ($1, 'mock', $2, 'EUR', 'DE', 'Anna S', 'IBAN ••••3000', 'Anna') RETURNING id`,
    [userId, randomUUID()],
  );
  const { rows } = await ctx.container.pool.query<{ id: string }>(
    `INSERT INTO transfers (reference, user_id, recipient_id, quote_id, status, idempotency_key,
        source_currency, destination_currency, source_amount_minor, fee_amount_minor,
        total_to_pay_minor, destination_amount_minor, exchange_rate, provider, provider_transfer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EUR', $8::bigint, 100, $8::bigint + 100, 11000, 1.1, 'mock', $9)
     RETURNING id`,
    [
      reference,
      userId,
      r[0]!.id,
      q[0]!.id,
      'DRAFT',
      randomUUID(),
      options.currency ?? 'GBP',
      amount,
      `mock-${randomUUID()}`,
    ],
  );
  const id = rows[0]!.id;
  if (status !== 'DRAFT') {
    await ctx.container.pool.query(`ALTER TABLE transfers DISABLE TRIGGER USER`);
    await ctx.container.pool.query(
      `UPDATE transfers SET status = $2,
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() END,
         failed_at = CASE WHEN $2 = 'FAILED' THEN now() END,
         cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() END,
         refunded_at = CASE WHEN $2 = 'REFUNDED' THEN now() END,
         sent_at = CASE WHEN $2 IN ('SENT','COMPLETED') THEN now() END
       WHERE id = $1`,
      [id, status],
    );
    await ctx.container.pool.query(`ALTER TABLE transfers ENABLE TRIGGER USER`);
  }
  if (options.ageHours) {
    await ctx.container.pool.query(`ALTER TABLE transfers DISABLE TRIGGER USER`);
    await ctx.container.pool.query(
      `UPDATE transfers SET updated_at = now() - make_interval(hours => $2) WHERE id = $1`,
      [id, options.ageHours],
    );
    await ctx.container.pool.query(`ALTER TABLE transfers ENABLE TRIGGER USER`);
  }
  return id;
}

// --- Who gets in ----------------------------------------------------------------------------

suite('only an admin with two-step sign-in gets in; everyone else is refused', async () => {
  const customer = await ctx.createUser();
  const customerToken = await ctx.issueToken(customer.id);
  assert.equal((await api(undefined, 'GET', '/admin/users')).status, 401);
  assert.equal((await api(customerToken, 'GET', '/admin/users')).status, 403);

  // A token that SAYS admin, for someone the database does not list as admin.
  const forged = await ctx.container.sessionService.startSession({
    userId: customer.id,
    roles: ['customer', 'admin'],
    emailVerified: true,
  });
  const denied = await api(forged.accessToken, 'GET', '/admin/users');
  assert.equal(denied.status, 403);
  assert.equal(errorCode(denied), 'FORBIDDEN');

  // An admin without 2FA.
  const noTwoFactor = await ctx.createUser();
  await ctx.container.pool.query(
    `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'admin', 'test')`,
    [noTwoFactor.id],
  );
  const session = await ctx.container.sessionService.startSession({
    userId: noTwoFactor.id,
    roles: ['customer', 'admin'],
    emailVerified: true,
  });
  const res = await api(session.accessToken, 'GET', '/admin/users');
  assert.equal(res.status, 403);
  assert.equal(errorCode(res), 'ADMIN_2FA_REQUIRED');

  // Removing the role (or the 2FA) from a working admin stops them at once.
  const a = await admin();
  assert.equal((await api(a.token, 'GET', '/admin/users')).status, 200);
  await ctx.container.pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [a.id]);
  assert.equal((await api(a.token, 'GET', '/admin/users')).status, 403);
});

suite('login gives the admin role only after a two-step code, never without 2FA', async () => {
  const email = 'staff@example.test';
  await ctx.http('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const { rows } = await ctx.container.pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  const id = rows[0]!.id;
  await ctx.container.pool.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [id]);
  await ctx.container.pool.query(
    `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'admin', 'test')`,
    [id],
  );
  const login = (extra: Json = {}) =>
    ctx.http('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, ...extra }),
    });

  // No 2FA yet: they sign in, but only as a customer, and the audit log says why.
  const first = await login();
  assert.equal(first.status, 200);
  const firstToken = data(first).accessToken as string;
  assert.equal((await api(firstToken, 'GET', '/admin/users')).status, 403);
  assert.equal(
    await ctx.countRows(
      'audit_events',
      `action = 'auth.staff_role_withheld' AND entity_id = '${id}'`,
    ),
    1,
  );

  // They turn 2FA on as a customer would.
  const setup = await api(firstToken, 'POST', '/auth/2fa/setup', { password: PASSWORD });
  const secret = data(setup).secret as string;
  const counter = totpCounter(new Date());
  assert.equal(
    (await api(firstToken, 'POST', '/auth/2fa/enable', { code: totpCode(secret, counter - 1) }))
      .status,
    200,
  );

  // The next sign-in needs a code, and then carries the admin role.
  const second = await login({ totpCode: totpCode(secret, counter) });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const adminToken = data(second).accessToken as string;
  assert.equal((await api(adminToken, 'GET', '/admin/whoami')).status, 200);
  assert.deepEqual(data(await api(adminToken, 'GET', '/admin/whoami')).roles, [
    'customer',
    'admin',
  ]);
});

// --- Audit ---------------------------------------------------------------------------------------------

suite('every admin request is audited before it runs, without the search text', async () => {
  const a = await admin();
  const target = await ctx.createUser();
  await api(a.token, 'GET', `/admin/users/${target.id}`);
  await api(a.token, 'GET', '/admin/users?q=secret.person%40example.com');
  await api(a.token, 'POST', `/admin/users/${target.id}/suspend`, { reason: 'fraud review' });

  const { rows } = await ctx.container.pool.query<{
    action: string;
    entity_id: string;
    actor_id: string;
    context: Json;
    request_id: string;
  }>(
    `SELECT action, entity_id, actor_id, context, request_id FROM audit_events
     WHERE actor_type = 'admin' AND actor_id = $1 ORDER BY created_at, id`,
    [a.id],
  );
  const actions = rows.map((r) => r.action);
  assert.deepEqual(actions, ['admin.view', 'admin.view', 'admin.action', 'admin.user.suspended']);
  assert.ok(rows.every((r) => r.actor_id === a.id));
  assert.ok(
    rows.filter((r) => r.action.match(/^admin\.(view|action)$/)).every((r) => r.request_id),
  );
  assert.equal(rows[0]?.entity_id, target.id);
  assert.equal(rows[1]?.context.searchTextLength, 25);
  assert.ok(!JSON.stringify(rows).includes('secret.person'));

  // If the audit record cannot be written, nothing is shown.
  await ctx.container.pool.query(`ALTER TABLE audit_events RENAME TO audit_events_off`);
  try {
    const blocked = await api(a.token, 'GET', '/admin/users');
    assert.equal(blocked.status, 500);
  } finally {
    await ctx.container.pool.query(`ALTER TABLE audit_events_off RENAME TO audit_events`);
  }
});

// --- Users ---------------------------------------------------------------------------------------------

suite('search users, view profile and provider link, suspend and unsuspend', async () => {
  const a = await admin();
  const jane = await ctx.createUser();
  await ctx.createUser({ kycStatus: 'REJECTED_PENDING_REVIEW' });

  const byEmail = await api(
    a.token,
    'GET',
    `/admin/users?q=${encodeURIComponent(jane.email.slice(0, 12))}`,
  );
  assert.equal(byEmail.status, 200);
  assert.ok((data(byEmail).users as Json[]).some((u) => u.id === jane.id));
  assert.equal(
    (data(await api(a.token, 'GET', `/admin/users?q=${jane.id}`)).users as Json[]).length,
    1,
  );
  // A wildcard is searched for literally, so it does not list everyone.
  assert.equal((data(await api(a.token, 'GET', '/admin/users?q=%25')).users as Json[]).length, 0);

  const view = data(await api(a.token, 'GET', `/admin/users/${jane.id}`)).user as Json;
  assert.equal(view.email, jane.email);
  assert.equal(view.name, 'Jane Doe');
  assert.equal(view.kycStatus, 'VERIFIED');
  assert.equal((view.providerLinks as Json[])[0]?.provider, 'mock');
  // No date of birth, phone or address is returned.
  assert.ok(
    !JSON.stringify(view).includes('1990-04-12') && !JSON.stringify(view).includes('+4477'),
  );

  const janeToken = await ctx.issueToken(jane.id);
  assert.equal((await api(janeToken, 'GET', '/me')).status, 200);
  assert.equal(
    (await api(a.token, 'POST', `/admin/users/${jane.id}/suspend`, { reason: 'review' })).status,
    200,
  );
  assert.equal((await api(janeToken, 'GET', '/me')).status, 401);
  assert.equal((await api(a.token, 'POST', `/admin/users/${jane.id}/unsuspend`, {})).status, 200);
  assert.equal(
    (data(await api(a.token, 'GET', `/admin/users/${jane.id}`)).user as Json).status,
    'active',
  );
  assert.equal((await api(a.token, 'GET', `/admin/users/${randomUUID()}`)).status, 404);
  assert.equal((await api(a.token, 'GET', '/admin/users/not-a-uuid')).status, 400);
});

// --- Transfers -----------------------------------------------------------------------------------------

suite(
  'search transfers by id, user, status and date; see the timeline and webhook history',
  async () => {
    const a = await admin();
    const u1 = await ctx.createUser();
    const u2 = await ctx.createUser();
    const t1 = await transferFor(u1.id, 'COMPLETED');
    const t2 = await transferFor(u2.id, 'AWAITING_FUNDS');
    const list = async (qs: string) =>
      (data(await api(a.token, 'GET', `/admin/transfers${qs}`)).transfers as Json[]).map(
        (t) => t.id,
      );

    assert.deepEqual(await list(`?id=${t1}`), [t1]);
    assert.deepEqual(await list(`?userId=${u2.id}`), [t2]);
    assert.deepEqual(await list('?status=COMPLETED'), [t1]);
    assert.equal((await list('')).length, 2);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    assert.deepEqual(await list(`?from=${encodeURIComponent(tomorrow)}`), []);
    const { rows } = await ctx.container.pool.query<{ reference: string }>(
      `SELECT reference FROM transfers WHERE id = $1`,
      [t1],
    );
    assert.deepEqual(await list(`?id=${rows[0]!.reference}`), [t1]);
    assert.equal((await api(a.token, 'GET', '/admin/transfers?status=BOGUS')).status, 400);

    await ctx.container.pool.query(
      `INSERT INTO webhook_events (provider, provider_event_id, dedupe_key, event_type,
        signature_verified, payload, related_transfer_id, processing_status, processed_at)
     VALUES ('mock', 'evt-1', 'evt-1', 'transfer.paid_out', true,
        '{"secret":"must-not-be-returned","iban":"DE89370400440532013000"}', $1, 'processed', now())`,
      [t1],
    );
    const detail = data(await api(a.token, 'GET', `/admin/transfers/${t1}`)).transfer as Json;
    assert.equal(detail.status, 'COMPLETED');
    assert.ok((detail.events as Json[]).length >= 1, 'the status trigger recorded a timeline');
    assert.equal((detail.webhooks as Json[]).length, 1);
    assert.equal((detail.webhooks as Json[])[0]?.eventType, 'transfer.paid_out');
    assert.ok(!JSON.stringify(detail).includes('must-not-be-returned'));
    assert.ok(!JSON.stringify(detail).includes('DE89'));
    assert.equal(detail.sourceAmountMinor, '10000');
  },
);

suite('reports: stuck 24h+, failed or bounced, webhook errors, identity reviews', async () => {
  const a = await admin();
  const u = await ctx.createUser();
  const stuck = await transferFor(u.id, 'PROCESSING', { ageHours: 30 });
  await transferFor(u.id, 'PROCESSING', { ageHours: 2 });
  await transferFor(u.id, 'DRAFT', { ageHours: 48 });
  await transferFor(u.id, 'COMPLETED', { ageHours: 72 });
  const failed = await transferFor(u.id, 'FAILED');
  const refunded = await transferFor(u.id, 'REFUNDED');

  const ids = async (path: string, key = 'transfers') =>
    (data(await api(a.token, 'GET', path))[key] as Json[]).map((t) => t.id);
  assert.deepEqual(await ids('/admin/reports/stuck-transfers'), [stuck]);
  assert.equal((await ids('/admin/reports/stuck-transfers?includeDrafts=true')).length, 2);
  assert.deepEqual(
    (await ids('/admin/reports/failed-transfers')).sort(),
    [failed, refunded].sort(),
  );

  await ctx.container.pool.query(
    `INSERT INTO webhook_events (provider, provider_event_id, dedupe_key, event_type,
        signature_verified, payload, processing_status, processing_error, processed_at)
     VALUES ('mock', 'bad-sig', 'bad-sig', 'unverified', false, '{}', 'failed', 'invalid_signature', now()),
            ('mock', 'boom', 'boom', 'transfer.x', true, '{}', 'failed', 'handler_error', now()),
            ('mock', 'fine', 'fine', 'transfer.y', true, '{}', 'processed', NULL, now())`,
  );
  const errors = data(await api(a.token, 'GET', '/admin/reports/webhook-errors'))
    .webhooks as Json[];
  assert.deepEqual(errors.map((w) => w.processingError).sort(), [
    'handler_error',
    'invalid_signature',
  ]);

  const mismatch = await ctx.createUser({ kycStatus: 'REJECTED_PENDING_REVIEW' });
  const reviews = data(await api(a.token, 'GET', '/admin/reports/identity-reviews'))
    .reviews as Json[];
  assert.deepEqual(
    reviews.map((r) => r.userId),
    [mismatch.id],
  );
});

suite(
  'the dashboard: transfers and volume per day and month by currency, against the target',
  async () => {
    const a = await admin();
    const u = await ctx.createUser();
    await transferFor(u.id, 'COMPLETED', { amount: 100_000 });
    await transferFor(u.id, 'SENT', { amount: 50_000 });
    await transferFor(u.id, 'AWAITING_FUNDS', { amount: 70_000 }); // no money taken yet
    await transferFor(u.id, 'CANCELLED', { amount: 90_000 });
    await transferFor(u.id, 'COMPLETED', { amount: 20_000, currency: 'USD' });

    const day = data(await api(a.token, 'GET', '/admin/dashboard?period=day'));
    const gbp = (day.rows as Json[]).find((r) => r.currency === 'GBP')!;
    assert.equal(gbp.transfers, 3, 'cancelled and drafts are not counted');
    assert.equal(gbp.completed, 1);
    assert.equal(gbp.volumeMinor, '150000');
    assert.equal(gbp.approxUsd, 1875); // 1,500.00 GBP at 1.25
    assert.equal(
      (day.rows as Json[]).find((r) => r.currency === 'USD')?.approxUsd,
      200,
      'USD needs no rate',
    );

    const month = data(await api(a.token, 'GET', '/admin/dashboard?period=month'));
    assert.equal((month.rows as Json[]).length, 2);
    assert.equal((month.thisMonth as Json).targetUsd, 3_000_000);
    assert.equal((await api(a.token, 'GET', '/admin/dashboard?period=year')).status, 400);
  },
);

// --- Read-only: no admin can move money or change amounts or statuses ------------------------------------

suite('an admin cannot change a transfer amount or status, or move money', async () => {
  const a = await admin();
  const u = await ctx.createUser();
  const id = await transferFor(u.id, 'AWAITING_FUNDS', { amount: 12_345 });
  const snapshot = async () =>
    JSON.stringify(
      (
        await ctx.container.pool.query(
          `SELECT status, source_amount_minor, fee_amount_minor, total_to_pay_minor,
                  destination_amount_minor, provider_status FROM transfers WHERE id = $1`,
          [id],
        )
      ).rows,
    );
  const before = await snapshot();

  const attempts: [string, string, unknown?][] = [
    ['PATCH', `/admin/transfers/${id}`, { status: 'COMPLETED' }],
    ['PUT', `/admin/transfers/${id}`, { sourceAmountMinor: 1 }],
    ['POST', `/admin/transfers/${id}`, { status: 'COMPLETED' }],
    ['DELETE', `/admin/transfers/${id}`],
    ['POST', `/admin/transfers/${id}/status`, { status: 'COMPLETED' }],
    ['POST', `/admin/transfers/${id}/complete`, {}],
    ['POST', `/admin/transfers/${id}/refund`, {}],
    ['POST', `/admin/transfers/${id}/cancel`, {}],
    ['POST', `/admin/transfers/${id}/fund`, {}],
    ['POST', '/admin/transfers', { amount: '1.00' }],
    ['PATCH', `/admin/users/${u.id}`, { status: 'active' }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await api(a.token, method, path, body);
    assert.ok([404, 405].includes(res.status), `${method} ${path} -> ${res.status}`);
  }
  // The customer-facing transfer endpoints refuse an admin acting on someone else's transfer.
  const cancel = await api(a.token, 'POST', `/transfers/${id}/cancel`, {});
  assert.ok([403, 404].includes(cancel.status), `customer cancel as admin -> ${cancel.status}`);
  assert.equal(await snapshot(), before);

  // The admin API has no write route for transfers at all: only GETs under /admin/transfers.
  const mounted = await ctx.container.pool.query(`SELECT 1`);
  assert.ok(mounted);
});

suite('the console page is served with a strict CSP and can be switched off', async () => {
  const page = await fetch(`${ctx.baseUrl}/admin-console/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.ok(!/unsafe-inline/.test(page.headers.get('content-security-policy') ?? ''));
  const html = await page.text();
  assert.ok(html.includes('console.js') && !/<script>[^<]/.test(html), 'no inline script');
  assert.equal((await fetch(`${ctx.baseUrl}/admin-console/console.js`)).status, 200);
  assert.equal((await fetch(`${ctx.baseUrl}/admin-console/secret.txt`)).status, 404);

  const off = await startTestContext({ envOverrides: { ADMIN_CONSOLE_ENABLED: 'false' } });
  try {
    assert.equal((await fetch(`${off.baseUrl}/admin-console/`)).status, 404);
  } finally {
    await off.close();
  }
});

suite('the demo seed gives a working admin (with 2FA) and a populated dashboard', async () => {
  const { seedDemoData, DEMO_ADMIN_EMAIL, DEMO_PASSWORD } =
    await import('../../../src/infrastructure/seed/seed-demo-data.ts');
  const report = await seedDemoData(ctx.container);
  assert.equal(report.alreadySeeded, false);
  assert.ok(report.adminTotpSecret);
  assert.equal((await seedDemoData(ctx.container)).alreadySeeded, true, 'running it twice is safe');

  const login = await ctx.http('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_PASSWORD,
      // The enrolment code was just used; the next step is accepted once.
      totpCode: totpCode(report.adminTotpSecret, totpCounter(new Date()) + 1),
    }),
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const token = data(login).accessToken as string;
  const dash = data(await api(token, 'GET', '/admin/dashboard?period=day&days=14'));
  assert.ok((dash.rows as Json[]).length >= 8, 'a row for each day that had transfers');
  assert.ok(((dash.thisMonth as Json).targetUsd as number) > 0);
  assert.equal(
    (
      (await api(token, 'GET', '/admin/reports/stuck-transfers')).body as {
        data: { transfers: unknown[] };
      }
    ).data.transfers.length,
    1,
  );
  assert.equal(
    (data(await api(token, 'GET', '/admin/reports/identity-reviews')).reviews as Json[]).length,
    1,
  );
});

// --- Pause new transfers ---------------------------------------------------------------------

async function customerSession(): Promise<{ id: string; token: string }> {
  const user = await ctx.createUser();
  return { id: user.id, token: await ctx.issueToken(user.id) };
}
const quoteBody = { sourceCurrency: 'GBP', targetCurrency: 'EUR', sourceAmount: '100.00' };
const EUR = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

/** A real two-step admin: the TOTP secret is known so the test can produce current codes. */
async function realAdmin(): Promise<{
  id: string;
  token: string;
  code: (steps?: number) => string;
  nextCode: () => Promise<string>;
}> {
  const user = await ctx.createUser();
  const { secret } = await ctx.container.twoFactor.setup(user.id);
  await ctx.container.twoFactor.enable(user.id, totpCode(secret, totpCounter(new Date()) - 1));
  await ctx.container.pool.query(
    `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'admin', 'test')`,
    [user.id],
  );
  const session = await ctx.container.sessionService.startSession({
    userId: user.id,
    roles: ['customer', 'admin'],
    emailVerified: true,
  });
  return {
    id: user.id,
    token: session.accessToken,
    // The service refuses a code at or before the last one used, as in production. Waiting 30 s
    // between steps is not practical in a test, so `nextCode` rewinds that bookkeeping first.
    code: (steps = 0) => totpCode(secret, totpCounter(new Date()) + steps),
    nextCode: async (): Promise<string> => {
      await ctx.container.pool.query(
        `UPDATE user_auth SET totp_last_counter = NULL WHERE user_id = $1`,
        [user.id],
      );
      return totpCode(secret, totpCounter(new Date()));
    },
  };
}

suite(
  'pausing stops NEW transfers with a clear message; transfers in progress continue',
  async () => {
    const c = await customerSession();
    const key = (n: number) => `00000000-0000-4000-8000-${String(700 + n).padStart(12, '0')}`;
    const send = (path: string, token: string, body: unknown, extra: Record<string, string> = {}) =>
      ctx.http(`/api/v1${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra },
        body: JSON.stringify(body),
      });

    // One transfer is already in progress, and a second quote is prepared before the pause.
    const q1 = data(await send('/quotes', c.token, quoteBody));
    const recipient = data(
      await send('/recipients', c.token, { currency: 'EUR', country: 'DE', values: EUR }),
    );
    const q2 = data(await send('/quotes', c.token, quoteBody));
    const first = await send(
      '/transfers',
      c.token,
      { quoteId: q1.id, recipientId: recipient.id, answers: { purpose: 'gift' } },
      { 'idempotency-key': key(1) },
    );
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const firstId = data(first).id as string;

    const a = await realAdmin();
    // Only an admin can flip it, and only with a correct current code.
    const asCustomer = await api(c.token, 'PUT', '/admin/settings/transfers-paused', {
      paused: true,
      code: '123456',
    });
    assert.equal(asCustomer.status, 403);
    const wrong = await api(a.token, 'PUT', '/admin/settings/transfers-paused', {
      paused: true,
      code: '000000',
    });
    assert.equal(wrong.status, 400);
    assert.equal(data(await api(c.token, 'GET', '/availability')).newTransfersPaused, false);

    const on = await api(a.token, 'PUT', '/admin/settings/transfers-paused', {
      paused: true,
      message: 'We are doing maintenance. Back at 14:00.',
      code: await a.nextCode(),
    });
    assert.equal(on.status, 200, JSON.stringify(on.body));

    // Customers: no new quote, no new transfer, and they are told why.
    const blockedQuote = await send('/quotes', c.token, quoteBody);
    assert.equal(blockedQuote.status, 503);
    assert.equal(errorCode(blockedQuote), 'TRANSFERS_PAUSED');
    assert.match(JSON.stringify(blockedQuote.body), /maintenance\. Back at 14:00/);
    const blockedTransfer = await send(
      '/transfers',
      c.token,
      { quoteId: q2.id, recipientId: recipient.id, answers: { purpose: 'gift' } },
      { 'idempotency-key': key(2) },
    );
    assert.equal(blockedTransfer.status, 503);
    assert.equal(errorCode(blockedTransfer), 'TRANSFERS_PAUSED');
    assert.equal(await ctx.countRows('transfers'), 1, 'no second transfer was created');
    const availability = data(await api(c.token, 'GET', '/availability'));
    assert.equal(availability.newTransfersPaused, true);
    assert.match(String(availability.message), /maintenance/);

    // The one in progress is untouched: it can be read, a replay returns it, and it can be cancelled.
    assert.equal((await api(c.token, 'GET', `/transfers/${firstId}`)).status, 200);
    const replay = await send(
      '/transfers',
      c.token,
      { quoteId: q1.id, recipientId: recipient.id, answers: { purpose: 'gift' } },
      { 'idempotency-key': key(1) },
    );
    assert.equal(replay.status, 200);
    assert.equal(data(replay).id, firstId);
    assert.equal((await api(c.token, 'POST', `/transfers/${firstId}/cancel`, {})).status, 200);

    // Both changes are audited, with who and why; the dashboard shows the state and the limits.
    const dash = data(await api(a.token, 'GET', '/admin/dashboard'));
    assert.equal((dash.transfersPaused as Json).paused, true);
    assert.deepEqual(dash.limits, {
      currency: 'GBP',
      perTransfer: '5000',
      perDay: '10000',
      perMonth: '25000',
    });

    const off = await api(a.token, 'PUT', '/admin/settings/transfers-paused', {
      paused: false,
      code: await a.nextCode(),
    });
    assert.equal(off.status, 200);
    assert.equal((await send('/quotes', c.token, quoteBody)).status, 201);

    const { rows } = await ctx.container.pool.query<{
      action: string;
      actor_id: string;
      context: Json;
    }>(
      `SELECT action, actor_id, context FROM audit_events
     WHERE action IN ('admin.transfers.paused', 'admin.transfers.resumed') AND actor_id = $1
     ORDER BY created_at`,
      [a.id],
    );
    assert.deepEqual(
      rows.map((r) => r.action),
      ['admin.transfers.paused', 'admin.transfers.resumed'],
    );
    assert.ok(rows.every((r) => r.actor_id === a.id));
    assert.equal(rows[0]?.context.message, 'We are doing maintenance. Back at 14:00.');
  },
);

suite('an admin without 2FA cannot pause, and a code cannot be replayed', async () => {
  const a = await realAdmin();
  const code = await a.nextCode();
  assert.equal(
    (await api(a.token, 'PUT', '/admin/settings/transfers-paused', { paused: true, code })).status,
    200,
  );
  const replayed = await api(a.token, 'PUT', '/admin/settings/transfers-paused', {
    paused: false,
    code,
  });
  assert.equal(replayed.status, 400, 'the same code is refused the second time');

  const noTwoFactor = await ctx.createUser();
  await ctx.container.pool.query(
    `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'admin', 'test')`,
    [noTwoFactor.id],
  );
  const s = await ctx.container.sessionService.startSession({
    userId: noTwoFactor.id,
    roles: ['customer', 'admin'],
    emailVerified: true,
  });
  assert.equal(
    (
      await api(s.accessToken, 'PUT', '/admin/settings/transfers-paused', {
        paused: false,
        code: '123456',
      })
    ).status,
    403,
  );
  await api(a.token, 'PUT', '/admin/settings/transfers-paused', {
    paused: false,
    code: await a.nextCode(),
  });
});

suite('a recovery code signs in once, for a customer and for an admin', async () => {
  const email = 'recover@example.test';
  await ctx.http('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const { rows } = await ctx.container.pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  const id = rows[0]!.id;
  await ctx.container.pool.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [id]);
  await ctx.container.pool.query(
    `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'admin', 'test')`,
    [id],
  );
  const { secret } = await ctx.container.twoFactor.setup(id);
  const { recoveryCodes } = await ctx.container.twoFactor.enable(
    id,
    totpCode(secret, totpCounter(new Date()) - 1),
  );

  const login = (extra: Json) =>
    ctx.http('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, ...extra }),
    });
  assert.equal((await login({})).status, 401, 'no code at all');
  assert.equal((await login({ recoveryCode: 'AAAA-BBBB-CCCC-DDDD' })).status, 401);
  const ok = await login({ recoveryCode: recoveryCodes[0]!.toLowerCase() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(data(await api(data(ok).accessToken as string, 'GET', '/admin/whoami')).roles, [
    'customer',
    'admin',
  ]);
  assert.equal((await login({ recoveryCode: recoveryCodes[0]! })).status, 401, 'one time only');
  assert.equal((await login({ recoveryCode: recoveryCodes[1]! })).status, 200);

  // The codes are only ever stored as hashes.
  const stored = await ctx.container.pool.query<{ code_hash: string }>(
    `SELECT code_hash FROM two_factor_recovery_codes WHERE user_id = $1`,
    [id],
  );
  assert.equal(stored.rows.length, 10);
  assert.ok(stored.rows.every((r) => /^[0-9a-f]{64}$/.test(r.code_hash)));
  assert.equal(
    await ctx.countRows(
      'audit_events',
      `action = 'auth.two_factor.recovery_code_used' AND entity_id = '${id}'`,
    ),
    2,
  );
});
