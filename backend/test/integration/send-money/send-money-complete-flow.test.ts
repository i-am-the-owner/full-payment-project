import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { ProviderUnavailableError } from '../../../src/domain/payout/errors.ts';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';

/**
 * The complete quote-first send-money flow over HTTP against a real database
 * and the mock provider: re-pricing for a recipient, creating exactly one
 * provider transfer, paying the provider, the timeline, history and limits.
 */

const suite = DATABASE_URL ? test : test.skip;
type Json = Record<string, unknown>;

interface Session {
  userId: string;
  token: string;
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

async function session(c: TestContext): Promise<Session> {
  const user = await c.createUser();
  return { userId: user.id, token: await c.issueToken(user.id) };
}
function call(
  c: TestContext,
  s: Session,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return c.http(path, {
    method,
    headers: {
      authorization: `Bearer ${s.token}`,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function data(res: { body: unknown }): Json {
  return (res.body as { data: Json }).data;
}
function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}
function key(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function quote(c: TestContext, s: Session, body: Json = {}): Promise<Json> {
  const res = await call(c, s, 'POST', '/api/v1/quotes', {
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmount: '100.00',
    ...body,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return data(res);
}
async function recipient(c: TestContext, s: Session, values: Json = EUR_VALUES): Promise<Json> {
  const res = await call(c, s, 'POST', '/api/v1/recipients', {
    currency: 'EUR',
    country: 'DE',
    values,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return data(res);
}
function confirm(c: TestContext, s: Session, q: Json, r: Json, k: string, extra: Json = {}) {
  return call(
    c,
    s,
    'POST',
    '/api/v1/transfers',
    { quoteId: q.id, recipientId: r.id, answers: { purpose: 'family_support' }, ...extra },
    { 'idempotency-key': k },
  );
}
async function providerTransferCount(c: TestContext): Promise<number> {
  return c.countRows('transfers', 'provider_transfer_id IS NOT NULL');
}

// --- The whole flow ----------------------------------------------------------------

suite('amount → recipient → questions → confirm → pay → COMPLETED, with a timeline', async () => {
  const s = await session(ctx);

  // 1. Amount: either side can be given; every figure is the provider's.
  const currencies = data(await call(ctx, s, 'GET', '/api/v1/currencies'));
  assert.deepEqual(currencies.provider, {
    name: 'mock',
    displayName: 'Mock Payments (test provider)',
  });
  const byTarget = await quote(ctx, s, { sourceAmount: undefined, targetAmount: '100.00' });
  assert.equal((byTarget.target as Json).amount, '100.00');
  const q = await quote(ctx, s);
  assert.deepEqual(Object.keys(q).sort(), [
    'estimatedDelivery',
    'exchangeRate',
    'expiresAt',
    'fee',
    'id',
    'source',
    'target',
    'totalToPay',
  ]);

  // 2. Recipient: the provider's own form, then the summary.
  const form = data(
    await call(ctx, s, 'POST', '/api/v1/recipient-form', { currency: 'EUR', country: 'DE' }),
  );
  assert.ok((form.fields as Json[]).some((f) => f.key === 'iban'));
  const r = await recipient(ctx, s);
  const priced = await call(ctx, s, 'POST', `/api/v1/quotes/${String(q.id)}/recipient`, {
    recipientId: r.id,
  });
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  assert.equal(data(priced).priceChanged, false);
  assert.equal(data(priced).id, q.id);

  // 3. Extra questions.
  const questions = data(
    await call(ctx, s, 'POST', '/api/v1/transfer-form', { quoteId: q.id, recipientId: r.id }),
  );
  assert.deepEqual(
    (questions.fields as Json[]).map((f) => f.key),
    ['purpose'],
  );

  // 4. Confirm.
  const created = await confirm(ctx, s, q, r, key(1), { reference: 'Rent March' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const transfer = data(created);
  assert.equal(transfer.status, 'AWAITING_FUNDS');
  assert.equal(transfer.recipientReference, 'Rent March');
  const id = String(transfer.id);

  // 5. Pay: the provider's bank details and reference; never ours.
  const funding = await call(ctx, s, 'GET', `/api/v1/transfers/${id}/funding`);
  assert.equal(funding.status, 200, JSON.stringify(funding.body));
  assert.equal(funding.headers.get('cache-control'), 'no-store');
  const methods = data(funding).methods as Json[];
  assert.deepEqual(
    methods.map((m) => m.method),
    ['BANK_TRANSFER', 'BALANCE'],
  );
  assert.deepEqual(methods[0]!.amount, transfer.totalToPay);
  assert.match(String(methods[0]!.reference), /^MOCK/);
  assert.ok((methods[0]!.bankDetails as Json[]).length > 0);

  const chosen = await call(ctx, s, 'POST', `/api/v1/transfers/${id}/fund`, {
    method: 'BANK_TRANSFER',
  });
  assert.equal(data(chosen).outcome, 'AWAITING_PAYMENT');
  assert.equal((data(chosen).transfer as Json).status, 'AWAITING_FUNDS');

  // 6. Status: each step arrives as a signed provider webhook.
  for (const expected of ['PROCESSING', 'SENT', 'COMPLETED']) {
    const step = await call(ctx, s, 'POST', `/dev/mock/transfers/${id}/advance`, {});
    assert.equal(data(step).status, expected);
  }

  // 7. Detail and history: from our own database, with the timeline.
  const detail = data(await call(ctx, s, 'GET', `/api/v1/transfers/${id}`));
  assert.equal(detail.status, 'COMPLETED');
  assert.deepEqual(
    (detail.timeline as Json[]).map((e) => e.status),
    ['DRAFT', 'AWAITING_FUNDS', 'PROCESSING', 'SENT', 'COMPLETED'],
  );
  assert.equal((detail.recipient as Json).accountSummary, 'IBAN ••••3000');
  assert.deepEqual(detail.provider, { name: 'mock', displayName: 'Mock Payments (test provider)' });
  assert.equal(detail.fundingMethod, 'BANK_TRANSFER');
  const history = data(await call(ctx, s, 'GET', '/api/v1/transfers'));
  assert.equal((history.transfers as Json[]).length, 1);
  assert.equal(history.hasMore, false);

  // Nothing can be paid or cancelled once it is done.
  assert.equal((await call(ctx, s, 'GET', `/api/v1/transfers/${id}/funding`)).status, 409);
  assert.equal((await call(ctx, s, 'POST', `/api/v1/transfers/${id}/cancel`, {})).status, 409);
});

suite('paying from the customer’s own balance moves the transfer on at once', async () => {
  const s = await session(ctx);
  const created = data(await confirm(ctx, s, await quote(ctx, s), await recipient(ctx, s), key(2)));
  const id = String(created.id);

  const paid = await call(ctx, s, 'POST', `/api/v1/transfers/${id}/fund`, { method: 'BALANCE' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(data(paid).outcome, 'FUNDED');
  assert.equal((data(paid).transfer as Json).status, 'PROCESSING');
  assert.equal((data(paid).transfer as Json).fundingMethod, 'BALANCE');

  // Cancelling is only possible before the funds are received.
  const cancel = await call(ctx, s, 'POST', `/api/v1/transfers/${id}/cancel`, {});
  assert.equal(cancel.status, 409);
  const again = await call(ctx, s, 'POST', `/api/v1/transfers/${id}/fund`, { method: 'BALANCE' });
  assert.equal(again.status, 409);
});

suite('when the provider needs the customer to approve, the API says what to show', async () => {
  const big = await startTestContext({
    envOverrides: {
      TRANSFER_LIMIT_PER_TRANSFER: '50000',
      TRANSFER_LIMIT_PER_DAY: '100000',
      TRANSFER_LIMIT_PER_MONTH: '100000',
    },
  });
  try {
    await big.reset();
    const s = await session(big);
    // Above the mock's SCA threshold (5,000.00).
    const created = data(
      await confirm(
        big,
        s,
        await quote(big, s, { sourceAmount: '6000.00' }),
        await recipient(big, s),
        key(3),
      ),
    );
    const res = await call(big, s, 'POST', `/api/v1/transfers/${String(created.id)}/fund`, {
      method: 'BALANCE',
    });
    assert.equal(res.status, 200);
    assert.equal(data(res).outcome, 'SCA_REQUIRED');
    assert.match(String(data(res).message), /approve this payment/);
    assert.equal((data(res).transfer as Json).status, 'AWAITING_FUNDS');

    // Above the mock balance (20,000.00): a typed error, and still payable by bank.
    const huge = data(
      await confirm(
        big,
        s,
        await quote(big, s, { sourceAmount: '25000.00' }),
        await recipient(big, s),
        key(4),
      ),
    );
    const broke = await call(big, s, 'POST', `/api/v1/transfers/${String(huge.id)}/fund`, {
      method: 'BALANCE',
    });
    assert.equal(broke.status, 409);
    assert.equal(errorCode(broke), 'INSUFFICIENT_FUNDS');
    assert.equal(
      data(await call(big, s, 'GET', `/api/v1/transfers/${String(huge.id)}`)).status,
      'AWAITING_FUNDS',
    );
  } finally {
    await big.close();
  }
});

// --- Quote rules -------------------------------------------------------------------

suite('an expired quote cannot be used for anything', async () => {
  const s = await session(ctx);
  const q = await quote(ctx, s);
  const r = await recipient(ctx, s);
  // Expiry cannot be waited for in a test; the stored quote is aged instead.
  // (Stored quotes are otherwise immutable, so the guard is lifted for one statement.)
  await ctx.container.pool.query(`ALTER TABLE transfer_quotes DISABLE TRIGGER USER`);
  await ctx.container.pool.query(
    `UPDATE transfer_quotes SET created_at = now() - interval '2 hours',
                                expires_at = now() - interval '1 minute' WHERE id = $1`,
    [q.id],
  );
  await ctx.container.pool.query(`ALTER TABLE transfer_quotes ENABLE TRIGGER USER`);

  const confirmed = await confirm(ctx, s, q, r, key(5));
  assert.equal(confirmed.status, 409);
  assert.equal(errorCode(confirmed), 'QUOTE_EXPIRED');
  for (const [path, body] of [
    [`/api/v1/quotes/${String(q.id)}/recipient`, { recipientId: r.id }],
    ['/api/v1/transfer-form', { quoteId: q.id, recipientId: r.id }],
  ] as const) {
    const res = await call(ctx, s, 'POST', path, body);
    assert.equal(res.status, 409, path);
    assert.equal(errorCode(res), 'QUOTE_EXPIRED', path);
  }
  assert.equal(await ctx.countRows('transfers'), 0);
});

suite(
  'a price that changes for the recipient gives a new quote, and the old one is never sent',
  async () => {
    const s = await session(ctx);
    const q = await quote(ctx, s);
    const business = await recipient(ctx, s, {
      ...EUR_VALUES,
      legalType: 'BUSINESS',
      businessName: 'Schmidt GmbH',
    });

    const priced = data(
      await call(ctx, s, 'POST', `/api/v1/quotes/${String(q.id)}/recipient`, {
        recipientId: business.id,
      }),
    );
    assert.equal(priced.priceChanged, true);
    assert.notEqual(priced.id, q.id);
    assert.deepEqual(priced.totalToPay, q.totalToPay);
    assert.equal((priced.fee as Json).amount, '1.40');
    assert.equal((q.fee as Json).amount, '0.90');
    assert.notDeepEqual(priced.target, q.target);

    const sent = await confirm(ctx, s, priced, business, key(6));
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(data(sent).status, 'AWAITING_FUNDS');
    assert.deepEqual(data(sent).fee, priced.fee);
    assert.deepEqual(data(sent).target, priced.target);
  },
);

// --- Exactly one provider transfer -------------------------------------------------

suite('double-clicking Confirm creates exactly one transfer here and at the provider', async () => {
  const mock = new MockPayoutProvider({ clock: () => new Date() });
  const single = await startTestContext({ payoutProvider: mock });
  try {
    await single.reset();
    const s = await session(single);
    const q = await quote(single, s);
    const r = await recipient(single, s);

    const responses = await Promise.all([
      confirm(single, s, q, r, key(7)),
      confirm(single, s, q, r, key(7)),
      confirm(single, s, q, r, key(7)),
      // A second tap that generated a different key still hits the same quote.
      confirm(single, s, q, r, key(8)),
    ]);
    for (const res of responses) {
      assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    }
    assert.equal(new Set(responses.map((res) => data(res).id)).size, 1);
    assert.equal(await single.countRows('transfers'), 1);
    assert.equal(mock.transferCount, 1);
    assert.equal(
      data(await call(single, s, 'GET', `/api/v1/transfers/${String(data(responses[0]).id)}`))
        .status,
      'AWAITING_FUNDS',
    );
  } finally {
    await single.close();
  }
});

suite(
  'a network retry after a lost provider answer creates exactly one provider transfer',
  async () => {
    const mock = new MockPayoutProvider({ clock: () => new Date() });
    const original = mock.createTransfer.bind(mock);
    let lostAnswers = 1;
    let creates = 0;
    let lookups = 0;
    mock.createTransfer = async (params) => {
      creates += 1;
      const created = await original(params);
      if (lostAnswers > 0) {
        lostAnswers -= 1;
        throw new ProviderUnavailableError('timeout', { outcomeUnknown: true });
      }
      return created;
    };
    const find = mock.findTransferByIdempotencyKey.bind(mock);
    mock.findTransferByIdempotencyKey = (params) => {
      lookups += 1;
      return find(params);
    };
    const flaky = await startTestContext({ payoutProvider: mock });
    try {
      await flaky.reset();
      const s = await session(flaky);
      const q = await quote(flaky, s);
      const r = await recipient(flaky, s);

      // The provider created it, but we never heard back: not failed, not sent twice.
      const first = await confirm(flaky, s, q, r, key(9));
      assert.equal(first.status, 201);
      assert.equal(data(first).status, 'DRAFT');
      assert.equal(mock.transferCount, 1);

      // The client retries with the same key: looked up first, then adopted.
      const retry = await confirm(flaky, s, q, r, key(9));
      assert.equal(retry.status, 200);
      assert.equal(data(retry).id, data(first).id);
      assert.equal(data(retry).status, 'AWAITING_FUNDS');
      assert.equal(lookups, 1);
      assert.equal(creates, 1);
      assert.equal(mock.transferCount, 1);
      assert.equal(await flaky.countRows('transfers'), 1);
      assert.equal(await providerTransferCount(flaky), 1);

      // The key sent to the provider is our own transfer UUID.
      const found = await find({
        link: { provider: 'mock', customerRef: `mock-verified-${s.userId}` },
        idempotencyKey: String(data(first).id),
      });
      assert.ok(found);
    } finally {
      await flaky.close();
    }
  },
);

// --- Limits ------------------------------------------------------------------------

suite(
  'per-transfer, daily and monthly limits are enforced before a transfer is created',
  async () => {
    const limited = await startTestContext({
      envOverrides: {
        TRANSFER_LIMIT_PER_TRANSFER: '500.00',
        TRANSFER_LIMIT_PER_DAY: '800.00',
        TRANSFER_LIMIT_PER_MONTH: '1000.00',
      },
    });
    try {
      await limited.reset();
      const s = await session(limited);
      const r = await recipient(limited, s);
      let n = 20;
      const send = async (amount: string) =>
        confirm(limited, s, await quote(limited, s, { sourceAmount: amount }), r, key((n += 1)));
      const limitOf = (res: { body: unknown }): string =>
        (res.body as { error: { fieldErrors: { message: string }[] } }).error.fieldErrors[0]!
          .message;

      const tooBig = await send('500.01');
      assert.equal(tooBig.status, 422);
      assert.equal(errorCode(tooBig), 'LIMIT_EXCEEDED');
      assert.equal(limitOf(tooBig), 'PER_TRANSFER');
      assert.match(
        (tooBig.body as { error: { message: string } }).error.message,
        /You can send up to 500\.00 GBP in one transfer/,
      );
      assert.equal(await limited.countRows('transfers'), 0);

      assert.equal((await send('500.00')).status, 201);
      assert.equal((await send('300.00')).status, 201);
      const overDay = await send('1.00');
      assert.equal(overDay.status, 422);
      assert.equal(limitOf(overDay), 'PER_DAY');

      // Two days later the day is clear, but the 30-day total still counts.
      await limited.container.pool.query(`ALTER TABLE transfers DISABLE TRIGGER USER`);
      await limited.container.pool.query(
        `UPDATE transfers SET created_at = created_at - interval '2 days'`,
      );
      await limited.container.pool.query(`ALTER TABLE transfers ENABLE TRIGGER USER`);
      assert.equal((await send('200.00')).status, 201);
      const overMonth = await send('1.00');
      assert.equal(overMonth.status, 422);
      assert.equal(limitOf(overMonth), 'PER_MONTH');

      // A cancelled transfer gives its allowance back.
      const { rows } = await limited.container.pool.query<{ id: string }>(
        `SELECT id FROM transfers ORDER BY created_at DESC LIMIT 1`,
      );
      const cancelled = await call(
        limited,
        s,
        'POST',
        `/api/v1/transfers/${rows[0]!.id}/cancel`,
        {},
      );
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal((await send('150.00')).status, 201);

      // Limits are per customer.
      const other = await session(limited);
      const theirs = await recipient(limited, other);
      assert.equal(
        (
          await confirm(
            limited,
            other,
            await quote(limited, other, { sourceAmount: '500.00' }),
            theirs,
            key(40),
          )
        ).status,
        201,
      );
      assert.equal(await limited.countRows('transfers', `status <> 'CANCELLED'`), 4);
    } finally {
      await limited.close();
    }
  },
);

// --- Recipients, history, input validation ------------------------------------------

suite(
  'a removed recipient disappears from the list, cannot be sent to, and history keeps it',
  async () => {
    const s = await session(ctx);
    const r = await recipient(ctx, s);
    const sent = data(await confirm(ctx, s, await quote(ctx, s), r, key(50)));

    const other = await session(ctx);
    assert.equal(
      (await call(ctx, other, 'DELETE', `/api/v1/recipients/${String(r.id)}`)).status,
      403,
    );

    const removed = await call(ctx, s, 'DELETE', `/api/v1/recipients/${String(r.id)}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(data(await call(ctx, s, 'GET', '/api/v1/recipients')).recipients, []);
    assert.equal(await ctx.countRows('recipients', `id = '${String(r.id)}' AND NOT is_active`), 1);

    const refused = await confirm(ctx, s, await quote(ctx, s), r, key(51));
    assert.equal(refused.status, 400);
    const detail = data(await call(ctx, s, 'GET', `/api/v1/transfers/${String(sent.id)}`));
    assert.equal((detail.recipient as Json).displayName, 'Anna Schmidt');
  },
);

suite('history is paged newest first and belongs to its owner', async () => {
  const s = await session(ctx);
  const r = await recipient(ctx, s);
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    ids.unshift(String(data(await confirm(ctx, s, await quote(ctx, s), r, key(60 + i))).id));
  }

  const first = data(await call(ctx, s, 'GET', '/api/v1/transfers?page=1&pageSize=2'));
  assert.deepEqual(
    (first.transfers as Json[]).map((t) => t.id),
    ids.slice(0, 2),
  );
  assert.equal(first.hasMore, true);
  const second = data(await call(ctx, s, 'GET', '/api/v1/transfers?page=2&pageSize=2'));
  assert.deepEqual(
    (second.transfers as Json[]).map((t) => t.id),
    ids.slice(2),
  );
  assert.equal(second.hasMore, false);

  for (const query of ['page=0', 'pageSize=500', 'page=abc', 'order=asc']) {
    assert.equal((await call(ctx, s, 'GET', `/api/v1/transfers?${query}`)).status, 400, query);
  }

  const other = await session(ctx);
  assert.deepEqual(data(await call(ctx, other, 'GET', '/api/v1/transfers')).transfers, []);
  for (const path of [`/api/v1/transfers/${ids[0]!}`, `/api/v1/transfers/${ids[0]!}/funding`]) {
    assert.equal((await call(ctx, other, 'GET', path)).status, 403, path);
  }
  assert.equal(
    (await call(ctx, other, 'POST', `/api/v1/transfers/${ids[0]!}/fund`, { method: 'BALANCE' }))
      .status,
    403,
  );
});

suite('every input is validated and errors are typed', async () => {
  const s = await session(ctx);
  const q = await quote(ctx, s);
  const r = await recipient(ctx, s);
  for (const [extra, label] of [
    [{ reference: 'x'.repeat(36) }, 'reference too long'],
    [{ reference: '<script>' }, 'reference characters'],
    [{ status: 'COMPLETED' }, 'unknown field'],
    [{ fee: '0.00' }, 'client-supplied fee'],
  ] as const) {
    const res = await confirm(ctx, s, q, r, key(70), extra);
    assert.equal(res.status, 400, label);
    assert.equal(errorCode(res), 'VALIDATION_ERROR', label);
  }
  const floatAmount = await call(ctx, s, 'POST', '/api/v1/quotes', {
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmount: 100.5,
  });
  assert.equal(floatAmount.status, 400);
  const badMethod = await call(ctx, s, 'POST', `/api/v1/transfers/${key(1)}/fund`, {
    method: 'CARD',
  });
  assert.equal(badMethod.status, 400);
  assert.equal((await call(ctx, s, 'GET', `/api/v1/transfers/${key(1)}/funding`)).status, 404);
  assert.equal(
    (await call(ctx, s, 'POST', `/api/v1/quotes/not-a-uuid/recipient`, { recipientId: r.id }))
      .status,
    400,
  );
  assert.equal(await ctx.countRows('transfers'), 0);
});

suite('every endpoint that prepares or moves money needs a VERIFIED customer', async () => {
  const user = await ctx.createUser({ kycStatus: 'PENDING' });
  const s = { userId: user.id, token: await ctx.issueToken(user.id) };
  const id = key(1);
  for (const [method, path, body] of [
    ['GET', '/api/v1/currencies', undefined],
    [
      'POST',
      '/api/v1/quotes',
      { sourceCurrency: 'GBP', targetCurrency: 'EUR', sourceAmount: '1.00' },
    ],
    ['POST', `/api/v1/quotes/${id}/recipient`, { recipientId: id }],
    ['GET', '/api/v1/recipients', undefined],
    ['POST', '/api/v1/recipient-form', { currency: 'EUR', country: 'DE' }],
    ['POST', '/api/v1/recipients', { currency: 'EUR', country: 'DE', values: {} }],
    ['DELETE', `/api/v1/recipients/${id}`, undefined],
    ['POST', '/api/v1/transfer-form', { quoteId: id, recipientId: id }],
    ['GET', `/api/v1/transfers/${id}/funding`, undefined],
    ['POST', `/api/v1/transfers/${id}/fund`, { method: 'BALANCE' }],
  ] as const) {
    const res = await call(ctx, s, method, path, body);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(errorCode(res), 'CUSTOMER_NOT_VERIFIED', `${method} ${path}`);
  }
  // Their own history stays readable.
  assert.equal((await call(ctx, s, 'GET', '/api/v1/transfers')).status, 200);
});
