import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';
import { faultyProvider } from '../../support/transfer-fakes.ts';

/**
 * The send-money flow end to end over HTTP, against a real database, with
 * `PAYOUT_PROVIDER=mock` and no other provider configuration.
 */

const suite = DATABASE_URL ? test : test.skip;

interface Session {
  userId: string;
  token: string;
}
type Json = Record<string, unknown>;

async function session(ctx: TestContext, providerVerified = true): Promise<Session> {
  const user = await ctx.createUser({ providerVerified });
  return { userId: user.id, token: await ctx.issueToken(user.id) };
}

function authed(token: string, extra: Record<string, string> = {}): RequestInit {
  return {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra },
  };
}

async function post(
  ctx: TestContext,
  s: Session,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.http(path, {
    method: 'POST',
    ...authed(s.token, headers),
    body: JSON.stringify(body),
  });
}

/** A deterministic UUID idempotency key, one per test scenario. */
function key(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function data(res: { body: unknown }): Json {
  return (res.body as { data: Json }).data;
}
function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}

const EUR_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

async function getQuote(ctx: TestContext, s: Session, sourceAmount = '100.00'): Promise<Json> {
  const res = await post(ctx, s, '/api/v1/quotes', {
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmount,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return data(res);
}

async function addRecipient(ctx: TestContext, s: Session): Promise<Json> {
  const res = await post(ctx, s, '/api/v1/recipients', {
    currency: 'EUR',
    country: 'DE',
    values: EUR_VALUES,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return data(res);
}

async function confirm(ctx: TestContext, s: Session, quote: Json, recipient: Json, key: string) {
  return post(
    ctx,
    s,
    '/api/v1/transfers',
    { quoteId: quote.id, recipientId: recipient.id, answers: { purpose: 'family_support' } },
    { 'idempotency-key': key },
  );
}

async function newTransfer(ctx: TestContext, s: Session, key: string): Promise<Json> {
  const res = await confirm(ctx, s, await getQuote(ctx, s), await addRecipient(ctx, s), key);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return data(res);
}

async function advance(ctx: TestContext, s: Session, transferId: string, status?: string) {
  return post(ctx, s, `/dev/mock/transfers/${transferId}/advance`, status ? { status } : {});
}

let ctx: TestContext;

before(async () => {
  if (!DATABASE_URL) return;
  // No provider configuration at all: the mock is the default.
  ctx = await startTestContext();
});
after(async () => {
  if (ctx) await ctx.close();
});

// --- Happy path ---------------------------------------------------------------

suite('with no provider configured the backend runs on the mock provider', () => {
  assert.equal(ctx.container.payoutProvider.name, 'mock');
  assert.equal(ctx.container.config.payoutProvider, 'mock');
});

suite('currencies and capabilities come from the provider at runtime', async () => {
  await ctx.reset();
  const s = await session(ctx);
  const res = await ctx.http('/api/v1/currencies', authed(s.token));
  assert.equal(res.status, 200);
  const body = data(res);
  assert.deepEqual(body.sourceCurrencies, ['GBP', 'EUR', 'USD']);
  assert.equal((body.currencies as unknown[]).length, 7);
  assert.deepEqual((body.features as Json).fundingMethods, ['BANK_TRANSFER', 'BALANCE']);
});

suite(
  'quote -> recipient -> transfer -> COMPLETED, driven by signed provider webhooks',
  async () => {
    await ctx.reset();
    const s = await session(ctx);

    // 1. Quote: every figure is the provider's, returned as strings.
    const quote = await getQuote(ctx, s);
    assert.deepEqual(quote.totalToPay, { currency: 'GBP', amount: '100.00', amountMinor: '10000' });
    assert.deepEqual(quote.fee, { currency: 'GBP', amount: '0.90', amountMinor: '90' });
    assert.deepEqual(quote.target, { currency: 'EUR', amount: '115.94', amountMinor: '11594' });
    assert.equal(quote.exchangeRate, '1.17');
    assert.ok(typeof quote.expiresAt === 'string');

    // 2. Recipient: the form is the provider's; only a summary comes back.
    const form = await post(ctx, s, '/api/v1/recipient-form', {
      currency: 'EUR',
      country: 'DE',
      quoteId: quote.id,
    });
    assert.equal(form.status, 200);
    assert.ok((data(form).fields as Json[]).some((f) => f.key === 'iban'));

    const recipient = await addRecipient(ctx, s);
    assert.equal(recipient.accountSummary, 'IBAN ••••3000');
    assert.equal(JSON.stringify(recipient).includes(EUR_VALUES.iban), false);

    // 3. Transfer: the provider's extra questions, then confirmation.
    const transferForm = await post(ctx, s, '/api/v1/transfer-form', {
      quoteId: quote.id,
      recipientId: recipient.id,
    });
    assert.deepEqual(
      (data(transferForm).fields as Json[]).map((f) => f.key),
      ['purpose'],
    );

    const created = await confirm(ctx, s, quote, recipient, key(1));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const transfer = data(created);
    assert.equal(transfer.status, 'AWAITING_FUNDS');
    assert.deepEqual(transfer.totalToPay, quote.totalToPay);

    // 4. The provider reports progress by signed webhook.
    const seen: unknown[] = [];
    for (let step = 0; step < 3; step += 1) {
      const res = await advance(ctx, s, transfer.id as string);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(data(res).webhookOutcome, 'received');
      seen.push(data(res).status);
    }
    assert.deepEqual(seen, ['PROCESSING', 'SENT', 'COMPLETED']);

    // 5. History is read from our own copy and shows the final status.
    const read = await ctx.http(`/api/v1/transfers/${transfer.id as string}`, authed(s.token));
    assert.equal(data(read).status, 'COMPLETED');
    const list = await ctx.http('/api/v1/transfers', authed(s.token));
    assert.equal((data(list).transfers as Json[]).length, 1);

    // Every step after creation was recorded as coming from the provider.
    const { rows } = await ctx.container.pool.query<{ status: string; source: string }>(
      `SELECT status, source FROM transfer_events
       WHERE transfer_id = $1 ORDER BY occurred_at`,
      [transfer.id],
    );
    assert.deepEqual(rows, [
      { status: 'DRAFT', source: 'SYSTEM' },
      { status: 'AWAITING_FUNDS', source: 'PROVIDER_RESPONSE' },
      { status: 'PROCESSING', source: 'WEBHOOK' },
      { status: 'SENT', source: 'WEBHOOK' },
      { status: 'COMPLETED', source: 'WEBHOOK' },
    ]);
  },
);

suite('recipient bank details are never stored, logged or audited by SomPay', async () => {
  await ctx.reset();
  ctx.logLines.length = 0;
  const s = await session(ctx);
  await addRecipient(ctx, s);

  const stored = await ctx.container.pool.query(`SELECT * FROM recipients`);
  const audit = await ctx.container.pool.query(`SELECT * FROM audit_events`);
  const everything = JSON.stringify([stored.rows, audit.rows, ctx.logLines]);
  assert.equal(everything.includes(EUR_VALUES.iban), false);
  assert.equal(stored.rows.length, 1);
});

suite('provider validation errors are returned as field errors', async () => {
  await ctx.reset();
  const s = await session(ctx);
  const res = await post(ctx, s, '/api/v1/recipients', {
    currency: 'EUR',
    country: 'DE',
    values: { ...EUR_VALUES, iban: 'nope' },
  });
  assert.equal(res.status, 400);
  assert.equal(errorCode(res), 'VALIDATION_ERROR');
  assert.deepEqual(
    (res.body as { error: { fieldErrors: Json[] } }).error.fieldErrors.map((f) => f.field),
    ['iban'],
  );
});

suite('an unsupported route or currency is refused', async () => {
  await ctx.reset();
  const s = await session(ctx);
  const route = await post(ctx, s, '/api/v1/quotes', {
    sourceCurrency: 'INR',
    targetCurrency: 'GBP',
    sourceAmount: '100.00',
  });
  assert.equal(route.status, 422);
  assert.equal(errorCode(route), 'ROUTE_NOT_SUPPORTED');

  const unknown = await post(ctx, s, '/api/v1/quotes', {
    sourceCurrency: 'XXX',
    targetCurrency: 'GBP',
    sourceAmount: '100.00',
  });
  assert.equal(unknown.status, 400);

  const both = await post(ctx, s, '/api/v1/quotes', {
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmount: '100.00',
    targetAmount: '100.00',
  });
  assert.equal(both.status, 400);
});

// --- Idempotency ---------------------------------------------------------------

suite(
  'a duplicate confirm with the same Idempotency-Key does not create a second transfer',
  async () => {
    await ctx.reset();
    const s = await session(ctx);
    const quote = await getQuote(ctx, s);
    const recipient = await addRecipient(ctx, s);

    const first = await confirm(ctx, s, quote, recipient, key(2));
    const second = await confirm(ctx, s, quote, recipient, key(2));
    assert.equal(first.status, 201);
    assert.equal(second.status, 200); // replayed
    assert.equal(data(first).id, data(second).id);
    assert.equal(await ctx.countRows('transfers', `user_id = '${s.userId}'`), 1);
  },
);

suite(
  'reusing a quote with a NEW Idempotency-Key returns the original transfer, not a 500',
  async () => {
    await ctx.reset();
    const s = await session(ctx);
    const quote = await getQuote(ctx, s);
    const recipient = await addRecipient(ctx, s);

    const first = await confirm(ctx, s, quote, recipient, key(3));
    const second = await confirm(ctx, s, quote, recipient, key(1003));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(data(second).id, data(first).id);
    assert.equal(await ctx.countRows('transfers', `user_id = '${s.userId}'`), 1);
  },
);

suite('a transfer needs an Idempotency-Key and the provider’s answers', async () => {
  await ctx.reset();
  const s = await session(ctx);
  const quote = await getQuote(ctx, s);
  const recipient = await addRecipient(ctx, s);

  const noKey = await post(ctx, s, '/api/v1/transfers', {
    quoteId: quote.id,
    recipientId: recipient.id,
  });
  assert.equal(noKey.status, 400);
  const notUuid = await post(
    ctx,
    s,
    '/api/v1/transfers',
    { quoteId: quote.id, recipientId: recipient.id },
    { 'idempotency-key': 'not-a-uuid-key' },
  );
  assert.equal(notUuid.status, 400);
  assert.equal(await ctx.countRows('transfers', `user_id = '${s.userId}'`), 0);

  // Missing answers: the provider rejects it, and the transfer is recorded as failed.
  const noAnswers = await post(
    ctx,
    s,
    '/api/v1/transfers',
    { quoteId: quote.id, recipientId: recipient.id },
    { 'idempotency-key': key(4) },
  );
  assert.equal(noAnswers.status, 201);
  assert.equal(data(noAnswers).status, 'FAILED');
  assert.equal(data(noAnswers).failureReason, 'create:VALIDATION_FAILED');
});

// --- Verification gate ---------------------------------------------------------

suite('a customer the provider has not verified cannot price or send money', async () => {
  await ctx.reset();
  const s = await session(ctx, false);

  for (const [path, body] of [
    ['/api/v1/quotes', { sourceCurrency: 'GBP', targetCurrency: 'EUR', sourceAmount: '100.00' }],
    ['/api/v1/recipient-form', { currency: 'EUR', country: 'DE' }],
    ['/api/v1/recipients', { currency: 'EUR', country: 'DE', values: EUR_VALUES }],
  ] as const) {
    const res = await post(ctx, s, path, body);
    assert.equal(res.status, 403, path);
    assert.equal(errorCode(res), 'CUSTOMER_NOT_VERIFIED', path);
  }
  const transfer = await post(
    ctx,
    s,
    '/api/v1/transfers',
    {
      quoteId: '00000000-0000-4000-8000-000000000000',
      recipientId: '00000000-0000-4000-8000-000000000000',
    },
    { 'idempotency-key': key(5) },
  );
  assert.equal(transfer.status, 403);
  assert.equal(errorCode(transfer), 'CUSTOMER_NOT_VERIFIED');

  // History stays readable.
  assert.equal((await ctx.http('/api/v1/transfers', authed(s.token))).status, 200);
  assert.equal(
    data(await ctx.http('/api/v1/onboarding/status', authed(s.token))).status,
    'UNVERIFIED',
  );
});

// --- Cancellation --------------------------------------------------------------

suite('the sender can cancel a transfer that is still awaiting funds, and not after', async () => {
  await ctx.reset();
  const s = await session(ctx);
  const waiting = await newTransfer(ctx, s, key(6));
  const cancelled = await post(ctx, s, `/api/v1/transfers/${waiting.id as string}/cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(data(cancelled).status, 'CANCELLED');
  const events = await ctx.container.pool.query<{ source: string }>(
    `SELECT source FROM transfer_events WHERE transfer_id = $1 AND status = 'CANCELLED'`,
    [waiting.id],
  );
  assert.deepEqual(events.rows, [{ source: 'USER' }]);

  const funded = await newTransfer(ctx, s, key(7));
  await advance(ctx, s, funded.id as string);
  const refused = await post(ctx, s, `/api/v1/transfers/${funded.id as string}/cancel`, {});
  assert.equal(refused.status, 409);
});

suite(
  "one customer cannot read, cancel, refresh or advance another customer's transfer",
  async () => {
    await ctx.reset();
    const owner = await session(ctx);
    const other = await session(ctx);
    const transfer = await newTransfer(ctx, owner, key(8));
    const id = transfer.id as string;

    assert.equal((await ctx.http(`/api/v1/transfers/${id}`, authed(other.token))).status, 403);
    assert.equal((await post(ctx, other, `/api/v1/transfers/${id}/cancel`, {})).status, 403);
    assert.equal((await post(ctx, other, `/api/v1/transfers/${id}/refresh`, {})).status, 403);
    assert.equal((await advance(ctx, other, id)).status, 403);
    assert.equal(
      (await ctx.http(`/dev/mock/transfers/${id}/advance`, { method: 'POST' })).status,
      401,
    );
  },
);

suite("a customer's recipient list holds only their own recipients", async () => {
  await ctx.reset();
  const owner = await session(ctx);
  const other = await session(ctx);
  const mine = await addRecipient(ctx, owner);

  const listed = async (s: Session): Promise<string[]> => {
    const res = await ctx.http('/api/v1/recipients', authed(s.token));
    assert.equal(res.status, 200);
    return (data(res).recipients as Json[]).map((r) => r.id as string);
  };
  assert.deepEqual(await listed(owner), [mine.id]);
  assert.deepEqual(await listed(other), []);
  // Nor can the other customer delete it.
  const del = await ctx.http(`/api/v1/recipients/${mine.id as string}`, {
    method: 'DELETE',
    ...authed(other.token),
  });
  assert.ok(del.status === 403 || del.status === 404, `got ${del.status}`);
  assert.deepEqual(await listed(owner), [mine.id]);
});

// --- Webhooks ------------------------------------------------------------------

suite(
  'the webhook endpoint verifies the signature, deduplicates and ignores other providers',
  async () => {
    await ctx.reset();
    const s = await session(ctx);
    const transfer = await newTransfer(ctx, s, key(9));
    const mock = ctx.container.payoutProvider as MockPayoutProvider;
    const { rows } = await ctx.container.pool.query<{ provider_transfer_id: string }>(
      `SELECT provider_transfer_id FROM transfers WHERE id = $1`,
      [transfer.id],
    );
    const webhook = mock.advanceTransfer(rows[0]!.provider_transfer_id);
    const send = (path: string, headers: Record<string, string | undefined>, body: Buffer) =>
      fetch(`${ctx.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(headers as Record<string, string>) },
        body,
      });

    // Unsigned and tampered deliveries are rejected and change nothing.
    assert.equal((await send('/webhooks/mock', {}, webhook.rawBody)).status, 401);
    const tampered = Buffer.from(webhook.rawBody.toString().replace('funded', 'delivered'));
    assert.equal((await send('/webhooks/mock', webhook.headers, tampered)).status, 401);
    // Each rejected attempt is recorded as an unverified delivery: no content.
    assert.equal(await ctx.countRows('webhook_events', 'signature_verified'), 0);
    assert.equal(await ctx.countRows('webhook_events', 'NOT signature_verified'), 2);

    // A webhook addressed to a provider that is not active is not accepted.
    assert.equal((await send('/webhooks/wise', webhook.headers, webhook.rawBody)).status, 404);

    // The genuine delivery is applied once, however often it is retried.
    const first = await send('/webhooks/mock', webhook.headers, webhook.rawBody);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: 'received' });
    const retry = await send('/webhooks/mock', webhook.headers, webhook.rawBody);
    assert.deepEqual(await retry.json(), { status: 'duplicate' });

    // Acknowledged at once; applied by the background worker.
    await ctx.container.background.runner.drain();
    assert.equal(await ctx.countRows('webhook_events', `processing_status = 'processed'`), 1);
    const read = await ctx.http(`/api/v1/transfers/${transfer.id as string}`, authed(s.token));
    assert.equal(data(read).status, 'PROCESSING');
  },
);

// --- Status-correction hardening -----------------------------------------------

suite(
  'only provider data can correct a FAILED transfer, and the correction is audited',
  async () => {
    await ctx.reset();
    const s = await session(ctx);
    const transfer = await newTransfer(ctx, s, key(10));
    const id = transfer.id as string;

    // The provider reports a failure...
    const failed = await advance(ctx, s, id, 'rejected');
    assert.equal(data(failed).status, 'FAILED');

    // ...no customer-facing endpoint can change that...
    assert.equal((await post(ctx, s, `/api/v1/transfers/${id}/cancel`, {})).status, 409);
    const quoteRows = await ctx.container.pool.query<{ quote_id: string }>(
      `SELECT quote_id FROM transfers WHERE id = $1`,
      [id],
    );
    const replay = await post(
      ctx,
      s,
      '/api/v1/transfers',
      {
        quoteId: quoteRows.rows[0]!.quote_id,
        recipientId: transfer.recipientId,
        answers: { purpose: 'family_support' },
      },
      { 'idempotency-key': key(10) },
    );
    assert.equal(data(replay).status, 'FAILED');

    // ...and neither can a direct database write without provider evidence.
    await assert.rejects(
      ctx.container.pool.query(
        `UPDATE transfers SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
        [id],
      ),
      /requires provider evidence/,
    );

    // The provider then reports a late success: the correction is applied...
    const corrected = await advance(ctx, s, id, 'delivered');
    assert.equal(data(corrected).status, 'COMPLETED');

    // ...and written to the audit log with where it came from.
    const { rows } = await ctx.container.pool.query<{ actor_type: string; context: Json }>(
      `SELECT actor_type, context FROM audit_events
     WHERE action = 'transfer.status_corrected_by_provider' AND entity_id = $1`,
      [id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actor_type, 'provider');
    assert.deepEqual(rows[0]!.context, {
      from: 'FAILED',
      to: 'COMPLETED',
      provider: 'mock',
      providerStatus: 'delivered',
      source: 'provider_webhook',
    });
  },
);

suite('an explicit refresh looks the transfer up at the provider and corrects it', async () => {
  await ctx.reset();
  const s = await session(ctx);
  const transfer = await newTransfer(ctx, s, key(11));
  const id = transfer.id as string;
  await advance(ctx, s, id, 'rejected');

  // The provider's own record moves on, but its webhook never reaches us.
  const mock = ctx.container.payoutProvider as MockPayoutProvider;
  const { rows } = await ctx.container.pool.query<{ provider_transfer_id: string }>(
    `SELECT provider_transfer_id FROM transfers WHERE id = $1`,
    [id],
  );
  mock.advanceTransfer(rows[0]!.provider_transfer_id, 'paid_out');

  // A plain read does not call the provider...
  assert.equal(data(await ctx.http(`/api/v1/transfers/${id}`, authed(s.token))).status, 'FAILED');
  // ...an explicit refresh does.
  const refreshed = await post(ctx, s, `/api/v1/transfers/${id}/refresh`, {});
  assert.equal(refreshed.status, 200);
  assert.equal(data(refreshed).status, 'SENT');

  const audit = await ctx.container.pool.query<{ context: Json }>(
    `SELECT context FROM audit_events
     WHERE action = 'transfer.status_corrected_by_provider' AND entity_id = $1`,
    [id],
  );
  assert.equal(audit.rows[0]?.context.source, 'provider_lookup');
});

// --- Unanswered provider calls (own container, injected faults) -----------------

suite(
  'an unanswered provider create leaves the transfer pending, and a retry completes it',
  async () => {
    const { provider, faults } = faultyProvider(new MockPayoutProvider(), {
      createTransferOutcomeUnknown: 1,
    });
    const flaky = await startTestContext({ payoutProvider: provider });
    try {
      await flaky.reset();
      const s = await session(flaky);
      const quote = await getQuote(flaky, s);
      const recipient = await addRecipient(flaky, s);

      const first = await confirm(flaky, s, quote, recipient, key(12));
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(data(first).status, 'DRAFT');
      assert.equal(data(first).failureReason, null);
      assert.equal(faults.createTransferOutcomeUnknown, 0);

      const retry = await confirm(flaky, s, quote, recipient, key(12));
      assert.equal(retry.status, 200);
      assert.equal(data(retry).id, data(first).id);
      assert.equal(data(retry).status, 'AWAITING_FUNDS');
      assert.equal(await flaky.countRows('transfers', `user_id = '${s.userId}'`), 1);
    } finally {
      await flaky.close();
    }
  },
);

// --- Balance funding flag --------------------------------------------------------

suite('balance funding happens only when the feature flag is on', async () => {
  const funded = await startTestContext({
    envOverrides: {
      ALMAPAY_BALANCE_FUNDING_ENABLED: 'true',
      // This test sends more than the default sending limits allow.
      TRANSFER_LIMIT_PER_TRANSFER: '50000',
      TRANSFER_LIMIT_PER_DAY: '50000',
      TRANSFER_LIMIT_PER_MONTH: '50000',
    },
  });
  try {
    await funded.reset();
    const s = await session(funded);
    const paid = await newTransfer(funded, s, key(13));
    assert.equal(paid.status, 'PROCESSING');
    const method = await funded.container.pool.query<{ funding_method: string }>(
      `SELECT funding_method FROM transfers WHERE id = $1`,
      [paid.id],
    );
    assert.equal(method.rows[0]?.funding_method, 'BALANCE');

    // More than the mock balance holds: the transfer fails, with a reason.
    const big = await confirm(
      funded,
      s,
      await getQuote(funded, s, '25000.00'),
      await addRecipient(funded, s),
      key(14),
    );
    assert.equal(data(big).status, 'FAILED');
    assert.equal(data(big).failureReason, 'funding:INSUFFICIENT_FUNDS');
  } finally {
    await funded.close();
  }
});
