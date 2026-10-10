import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';

/**
 * User A must not be able to read or act on user B's data, for every resource:
 * quotes, recipients and transfers. Each attempt must be refused AND leave the
 * owner's data untouched.
 */

const suite = DATABASE_URL ? test : test.skip;
type Json = Record<string, unknown>;

interface Session {
  userId: string;
  token: string;
}
interface Owned {
  quote: Json;
  recipient: Json;
  transfer: Json;
  /** A second, unused quote and recipient the owner holds. */
  spareQuote: Json;
  spareRecipient: Json;
  idempotencyKey: string;
}

const EUR_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

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

const data = (res: { body: unknown }): Json => (res.body as { data: Json }).data;
const code = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;

async function session(): Promise<Session> {
  const user = await ctx.createUser();
  return { userId: user.id, token: await ctx.issueToken(user.id) };
}
function call(
  s: Session | undefined,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.http(path, {
    method,
    headers: {
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const quoteOf = async (s: Session): Promise<Json> =>
  data(
    await call(s, 'POST', '/api/v1/quotes', {
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmount: '100.00',
    }),
  );
const recipientOf = async (s: Session): Promise<Json> =>
  data(
    await call(s, 'POST', '/api/v1/recipients', {
      currency: 'EUR',
      country: 'DE',
      values: EUR_VALUES,
    }),
  );

let n = 0;
async function ownerWithData(s: Session): Promise<Owned> {
  const quote = await quoteOf(s);
  const recipient = await recipientOf(s);
  n += 1;
  const idempotencyKey = `00000000-0000-4000-8000-${String(700 + n).padStart(12, '0')}`;
  const created = await call(
    s,
    'POST',
    '/api/v1/transfers',
    { quoteId: quote.id, recipientId: recipient.id, answers: { purpose: 'gift' } },
    { 'idempotency-key': idempotencyKey },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return {
    quote,
    recipient,
    transfer: data(created),
    spareQuote: await quoteOf(s),
    spareRecipient: await recipientOf(s),
    idempotencyKey,
  };
}

/** The owner's data, as the database holds it. */
async function snapshot(owned: Owned) {
  const transfer = await ctx.container.pool.query(
    `SELECT status, provider_status, funding_method FROM transfers WHERE id = $1`,
    [owned.transfer.id],
  );
  const recipients = await ctx.container.pool.query(
    `SELECT id, is_active FROM recipients WHERE user_id = (SELECT user_id FROM transfers WHERE id = $1) ORDER BY id`,
    [owned.transfer.id],
  );
  const transfers = await ctx.container.pool.query(`SELECT count(*)::int AS n FROM transfers`);
  return { transfer: transfer.rows, recipients: recipients.rows, transfers: transfers.rows };
}

suite('user B cannot touch user A’s QUOTES', async () => {
  const a = await session();
  const b = await session();
  const owned = await ownerWithData(a);
  const bRecipient = await recipientOf(b);
  const before = await snapshot(owned);
  const quoteId = String(owned.spareQuote.id);

  for (const [label, res] of [
    [
      'attach a recipient to it',
      await call(b, 'POST', `/api/v1/quotes/${quoteId}/recipient`, { recipientId: bRecipient.id }),
    ],
    [
      'ask for its transfer questions',
      await call(b, 'POST', '/api/v1/transfer-form', { quoteId, recipientId: bRecipient.id }),
    ],
    [
      'ask for a recipient form for it',
      await call(b, 'POST', '/api/v1/recipient-form', { currency: 'EUR', country: 'DE', quoteId }),
    ],
    [
      'send a transfer from it',
      await call(
        b,
        'POST',
        '/api/v1/transfers',
        { quoteId, recipientId: bRecipient.id, answers: { purpose: 'gift' } },
        { 'idempotency-key': '00000000-0000-4000-8000-000000000b01' },
      ),
    ],
  ] as const) {
    assert.equal(res.status, 403, label);
    assert.equal(code(res), 'FORBIDDEN', label);
  }
  assert.deepEqual(await snapshot(owned), before);
  // The quote is still A's, and still usable by A.
  assert.equal(
    (
      await call(a, 'POST', `/api/v1/quotes/${quoteId}/recipient`, {
        recipientId: owned.spareRecipient.id,
      })
    ).status,
    200,
  );
});

suite('user B cannot touch user A’s RECIPIENTS', async () => {
  const a = await session();
  const b = await session();
  const owned = await ownerWithData(a);
  const bQuote = await quoteOf(b);
  const before = await snapshot(owned);
  const recipientId = String(owned.spareRecipient.id);

  assert.equal((await call(b, 'DELETE', `/api/v1/recipients/${recipientId}`)).status, 403);
  assert.equal(
    (await call(b, 'POST', `/api/v1/quotes/${String(bQuote.id)}/recipient`, { recipientId }))
      .status,
    403,
  );
  assert.equal(
    (await call(b, 'POST', '/api/v1/transfer-form', { quoteId: bQuote.id, recipientId })).status,
    403,
  );
  const send = await call(
    b,
    'POST',
    '/api/v1/transfers',
    { quoteId: bQuote.id, recipientId, answers: { purpose: 'gift' } },
    { 'idempotency-key': '00000000-0000-4000-8000-000000000b02' },
  );
  assert.equal(send.status, 403);

  // B's own list never contains A's recipients.
  const listed = (data(await call(b, 'GET', '/api/v1/recipients')).recipients as Json[]).map(
    (r) => r.id,
  );
  assert.deepEqual(listed, []);
  assert.deepEqual(await snapshot(owned), before);
  assert.equal(await ctx.countRows('recipients', `id = '${recipientId}' AND is_active`), 1);
});

suite('user B cannot read or act on user A’s TRANSFERS', async () => {
  const a = await session();
  const b = await session();
  const owned = await ownerWithData(a);
  const before = await snapshot(owned);
  const id = String(owned.transfer.id);

  for (const [label, res] of [
    ['read it', await call(b, 'GET', `/api/v1/transfers/${id}`)],
    ['read how to pay for it', await call(b, 'GET', `/api/v1/transfers/${id}/funding`)],
    [
      'pay for it from a balance',
      await call(b, 'POST', `/api/v1/transfers/${id}/fund`, { method: 'BALANCE' }),
    ],
    [
      'choose bank transfer for it',
      await call(b, 'POST', `/api/v1/transfers/${id}/fund`, { method: 'BANK_TRANSFER' }),
    ],
    ['cancel it', await call(b, 'POST', `/api/v1/transfers/${id}/cancel`, {})],
    ['refresh it from the provider', await call(b, 'POST', `/api/v1/transfers/${id}/refresh`, {})],
    ['advance it (dev tool)', await call(b, 'POST', `/dev/mock/transfers/${id}/advance`, {})],
    [
      'send it a webhook (dev tool)',
      await call(b, 'POST', `/dev/mock/transfers/${id}/webhook`, { status: 'delivered' }),
    ],
  ] as const) {
    assert.equal(res.status, 403, label);
    assert.ok(
      !JSON.stringify(res.body).includes('Anna'),
      `${label}: nothing about the transfer leaks`,
    );
    assert.ok(!JSON.stringify(res.body).includes('DE89'), `${label}: no bank details leak`);
  }

  // History lists only the caller's own transfers.
  assert.deepEqual(data(await call(b, 'GET', '/api/v1/transfers')).transfers, []);
  assert.deepEqual(await snapshot(owned), before);
  assert.equal(data(await call(a, 'GET', `/api/v1/transfers/${id}`)).status, 'AWAITING_FUNDS');
});

suite('an idempotency key used by A cannot be used by B, and says nothing about A', async () => {
  const a = await session();
  const b = await session();
  const owned = await ownerWithData(a);
  const bQuote = await quoteOf(b);
  const bRecipient = await recipientOf(b);
  const before = await snapshot(owned);

  const reuse = await call(
    b,
    'POST',
    '/api/v1/transfers',
    { quoteId: bQuote.id, recipientId: bRecipient.id, answers: { purpose: 'gift' } },
    { 'idempotency-key': owned.idempotencyKey },
  );
  assert.equal(reuse.status, 409, JSON.stringify(reuse.body));
  assert.ok(!JSON.stringify(reuse.body).includes(String(owned.transfer.id)));
  assert.ok(!JSON.stringify(reuse.body).includes(String(owned.transfer.reference)));
  assert.deepEqual(await snapshot(owned), before);
  assert.equal(await ctx.countRows('transfers', `user_id = '${b.userId}'`), 0);
});

suite('no resource endpoint answers a request without a valid token', async () => {
  const a = await session();
  const owned = await ownerWithData(a);
  const id = String(owned.transfer.id);
  const rid = String(owned.recipient.id);
  const qid = String(owned.quote.id);
  const zero = '00000000-0000-4000-8000-000000000000';

  for (const [method, path, body] of [
    ['GET', '/api/v1/me', undefined],
    ['GET', '/api/v1/currencies', undefined],
    ['POST', '/api/v1/quotes', {}],
    ['POST', `/api/v1/quotes/${qid}/recipient`, { recipientId: rid }],
    ['GET', '/api/v1/recipients', undefined],
    ['POST', '/api/v1/recipient-form', {}],
    ['POST', '/api/v1/recipients', {}],
    ['DELETE', `/api/v1/recipients/${rid}`, undefined],
    ['POST', '/api/v1/transfer-form', {}],
    ['POST', '/api/v1/transfers', {}],
    ['GET', '/api/v1/transfers', undefined],
    ['GET', `/api/v1/transfers/${id}`, undefined],
    ['GET', `/api/v1/transfers/${id}/funding`, undefined],
    ['POST', `/api/v1/transfers/${id}/fund`, { method: 'BALANCE' }],
    ['POST', `/api/v1/transfers/${id}/cancel`, {}],
    ['POST', `/api/v1/transfers/${id}/refresh`, {}],
    ['GET', '/api/v1/profile', undefined],
    ['PUT', '/api/v1/profile', {}],
    ['GET', '/api/v1/onboarding/status', undefined],
    ['POST', '/api/v1/onboarding/start', {}],
    ['POST', '/api/v1/auth/2fa/setup', {}],
    ['GET', '/api/v1/admin/alerts', undefined],
    ['POST', `/api/v1/admin/users/${zero}/suspend`, { reason: 'test' }],
    ['POST', `/dev/mock/transfers/${id}/advance`, {}],
  ] as const) {
    for (const s of [undefined, { userId: 'x', token: 'not.a.token' }]) {
      const res = await call(s, method, path, body);
      assert.equal(res.status, 401, `${method} ${path} ${s ? 'garbage token' : 'no token'}`);
    }
  }
});

suite(
  'a customer cannot use the admin endpoints, and cannot make themselves an admin',
  async () => {
    const b = await session();
    const zero = '00000000-0000-4000-8000-000000000000';
    assert.equal((await call(b, 'GET', '/api/v1/admin/alerts')).status, 403);
    assert.equal((await call(b, 'GET', '/api/v1/admin/whoami')).status, 403);
    assert.equal(
      (await call(b, 'POST', `/api/v1/admin/users/${zero}/suspend`, { reason: 'because' })).status,
      403,
    );
    assert.equal((await call(b, 'POST', `/api/v1/admin/users/${zero}/reinstate`, {})).status, 403);
    // Roles come from the signed session, never from a request body or header.
    const sneaky = await ctx.http('/api/v1/admin/alerts', {
      headers: { authorization: `Bearer ${b.token}`, 'x-roles': 'admin', 'x-admin': 'true' },
    });
    assert.equal(sneaky.status, 403);
  },
);

suite('one customer logging out everywhere does not end another customer’s sessions', async () => {
  const a = await session();
  const b = await session();
  assert.equal((await call(b, 'POST', '/api/v1/auth/logout-all', {})).status, 200);
  assert.equal((await call(b, 'GET', '/api/v1/me')).status, 401);
  assert.equal((await call(a, 'GET', '/api/v1/me')).status, 200);
});
