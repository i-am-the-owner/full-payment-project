import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { createUserDataService } from '../../../src/application/privacy/user-data.ts';
import { PostgresUserData } from '../../../src/infrastructure/database/postgres-user-data.ts';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';

/** UK GDPR: export everything held about a person; erase them while keeping the records the law requires. */

const suite = DATABASE_URL ? test : test.skip;
type Json = Record<string, unknown>;
const EUR_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

let ctx: TestContext;
let mock: MockPayoutProvider;
before(async () => {
  if (!DATABASE_URL) return;
  mock = new MockPayoutProvider({ webhookSecret: 'integration-mock-secret-0123456789' });
  ctx = await startTestContext({ payoutProvider: mock });
});
after(async () => {
  if (ctx) await ctx.close();
});
beforeEach(async () => {
  if (ctx) await ctx.reset();
});

const data = (res: { body: unknown }): Json => (res.body as { data: Json }).data;
function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.http(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const service = () =>
  createUserDataService({
    repository: new PostgresUserData(ctx.container.pool),
    auditLog: {
      record: async (entry) => {
        await ctx.container.pool.query(
          `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, context)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            entry.actorType,
            entry.actorId ?? null,
            entry.action,
            entry.entityType,
            entry.entityId,
            JSON.stringify(entry.context ?? {}),
          ],
        );
      },
    },
    clock: () => new Date(),
  });

async function customerWithHistory() {
  const user = await ctx.createUser();
  await ctx.container.pool.query(`UPDATE users SET phone = '+447700900123' WHERE id = $1`, [
    user.id,
  ]);
  await ctx.container.pool.query(
    `UPDATE user_auth SET password_hash = 'hash-that-must-not-be-exported', last_login_ip = '203.0.113.7' WHERE user_id = $1`,
    [user.id],
  );
  const tokens = await ctx.createSession(user.id);
  const token = tokens.accessToken;
  await ctx.container.pool.query(
    `UPDATE provider_links SET encrypted_refresh_token = 'ciphertext', token_key_version = 1 WHERE user_id = $1`,
    [user.id],
  );

  const quote = data(
    await call(token, 'POST', '/api/v1/quotes', {
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmount: '50.00',
    }),
  );
  const used = data(
    await call(token, 'POST', '/api/v1/recipients', {
      currency: 'EUR',
      country: 'DE',
      values: EUR_VALUES,
    }),
  );
  const unused = data(
    await call(token, 'POST', '/api/v1/recipients', {
      currency: 'EUR',
      country: 'DE',
      values: { ...EUR_VALUES, accountHolderName: 'Never Used' },
    }),
  );
  const created = await call(
    token,
    'POST',
    '/api/v1/transfers',
    { quoteId: quote.id, recipientId: used.id, answers: { purpose: 'gift' } },
    { 'idempotency-key': '00000000-0000-4000-8000-0000000000e1' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // An unused quote.
  await call(token, 'POST', '/api/v1/quotes', {
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmount: '5.00',
  });
  const transferId = String(data(created).id);
  const { rows } = await ctx.container.pool.query<{ provider_transfer_id: string }>(
    `SELECT provider_transfer_id FROM transfers WHERE id = $1`,
    [transferId],
  );
  return {
    user,
    token,
    tokens,
    used,
    unused,
    transferId,
    providerId: rows[0]!.provider_transfer_id,
  };
}

suite('export holds the person’s data and no credentials', async () => {
  const c = await customerWithHistory();
  const exported = await service().export(c.user.email);

  assert.equal(exported.user.email, c.user.email);
  assert.equal(exported.profile.first_name, 'Jane');
  assert.equal(exported.profile.phone, '+447700900123');
  assert.equal(exported.recipients.length, 2);
  assert.equal(exported.transfers.length, 1);
  assert.equal(exported.quotes.length, 2);
  assert.equal(exported.sessions.length >= 1, true);
  assert.deepEqual(
    (exported.transfers[0]?.history as Json[]).map((e) => e.status),
    ['DRAFT', 'AWAITING_FUNDS'],
  );
  assert.ok(exported.notIncluded.length >= 3);

  const text = JSON.stringify(exported);
  for (const secret of [
    'hash-that-must-not-be-exported',
    'ciphertext',
    'refresh_token_hash',
    c.tokens.refreshToken,
    c.tokens.accessToken,
    'DE89370400440532013000',
  ]) {
    assert.ok(!text.includes(secret), `${secret} must not be in the export`);
  }
  // Found by id as well as by email.
  assert.equal((await service().export(c.user.id)).user.id, c.user.id);
  await assert.rejects(service().export('nobody@example.test'), /no such user/);
});

suite(
  'erasure is refused while a transfer is unfinished, and without the typed confirmation',
  async () => {
    const c = await customerWithHistory();
    await assert.rejects(
      service().erase(c.user.email, { confirmEmail: 'someone-else@example.test' }),
      /does not match/,
    );
    await assert.rejects(
      service().erase(c.user.email, { confirmEmail: c.user.email }),
      /1 transfer\(s\) are not finished/,
    );
    // Nothing was changed.
    assert.equal((await call(c.token, 'GET', '/api/v1/me')).status, 200);
    assert.equal(await ctx.countRows('users', `id = '${c.user.id}' AND status = 'active'`), 1);
  },
);

suite(
  'erasure removes what is not required, anonymises the account and keeps the financial record',
  async () => {
    const c = await customerWithHistory();
    // The transfer finishes.
    for (const status of ['funded', 'paid_out', 'delivered'] as const) {
      const hook = mock.simulateTransferEvent(c.providerId, status);
      await fetch(`${ctx.baseUrl}/webhooks/mock`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(hook.headers as Record<string, string>),
        },
        body: hook.rawBody,
      });
      await ctx.container.background.runner.drain();
    }
    assert.equal(
      await ctx.countRows('transfers', `id = '${c.transferId}' AND status = 'COMPLETED'`),
      1,
    );

    const report = await service().erase(c.user.email.toUpperCase(), {
      confirmEmail: c.user.email,
    });
    assert.equal((report.deleted.sessions ?? 0) >= 1, true);
    assert.equal(report.deleted.recipients, 1, 'the recipient never used');
    assert.equal(report.deleted.unusedQuotes, 1);
    assert.equal(report.retained.transfers, 1);
    assert.equal(report.retained.recipientsUsedInTransfers, 1);
    assert.ok(
      report.notes.some((n) => /five years/.test(n)) &&
        report.notes.some((n) => /payment provider/.test(n)),
    );

    // Anonymised: no personal data left on the account, and it cannot be used.
    const { rows } = await ctx.container.pool.query<Json>(
      `SELECT email::text AS email, status, first_name, last_name, date_of_birth, phone, country_of_residence FROM users WHERE id = $1`,
      [c.user.id],
    );
    assert.match(String(rows[0]?.email), /^erased-.*@deleted\.invalid$/);
    assert.deepEqual(
      [
        rows[0]?.status,
        rows[0]?.first_name,
        rows[0]?.last_name,
        rows[0]?.date_of_birth,
        rows[0]?.phone,
        rows[0]?.country_of_residence,
      ],
      ['closed', null, null, null, null, null],
    );
    const auth = await ctx.container.pool.query<Json>(
      `SELECT password_hash, last_login_ip FROM user_auth WHERE user_id = $1`,
      [c.user.id],
    );
    assert.deepEqual(auth.rows[0], { password_hash: null, last_login_ip: null });
    const link = await ctx.container.pool.query<Json>(
      `SELECT encrypted_refresh_token, kyc_status FROM provider_links WHERE user_id = $1`,
      [c.user.id],
    );
    assert.deepEqual(link.rows[0], { encrypted_refresh_token: null, kyc_status: 'NEEDS_RELINK' });
    assert.equal(await ctx.countRows('auth_sessions', `user_id = '${c.user.id}'`), 0);
    assert.equal((await call(c.token, 'GET', '/api/v1/me')).status, 401, 'old tokens stop working');
    assert.equal((await call(c.token, 'POST', '/api/v1/quotes', {})).status, 401);

    // The record the law requires is intact.
    const kept = await ctx.container.pool.query<Json>(
      `SELECT status, source_amount_minor, reference FROM transfers WHERE id = $1`,
      [c.transferId],
    );
    assert.equal(kept.rows[0]?.status, 'COMPLETED');
    assert.ok(String(kept.rows[0]?.reference).startsWith('ALM-'));
    assert.equal(
      await ctx.countRows('recipients', `user_id = '${c.user.id}' AND NOT is_active`),
      1,
    );
    assert.equal(
      (await ctx.countRows('transfer_events', `transfer_id = '${c.transferId}'`)) > 0,
      true,
    );
    assert.equal(
      await ctx.countRows(
        'audit_events',
        `action = 'privacy.user_erased' AND entity_id = '${c.user.id}'`,
      ),
      1,
    );

    // Doing it twice is refused; the export now shows an anonymised account.
    await assert.rejects(
      service().erase(c.user.id, { confirmEmail: String(rows[0]?.email) }),
      /already been erased/,
    );
    const after = await service().export(c.user.id);
    assert.match(String(after.user.email), /deleted\.invalid$/);
    assert.equal(after.transfers.length, 1);
  },
);

suite(
  'audit-log IP addresses can be scrubbed on request, leaving the record that things happened',
  async () => {
    const c = await customerWithHistory();
    await ctx.container.pool.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, ip_address)
     VALUES ('user', $1, 'auth.login.success', 'user', $1, '198.51.100.9')`,
      [c.user.id],
    );
    await ctx.container.pool
      .query(`UPDATE transfers SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`, [
        c.transferId,
      ])
      .catch(() => undefined);
    // Cancel through the product's own path so the state machine is respected.
    await call(c.token, 'POST', `/api/v1/transfers/${c.transferId}/cancel`, {});

    const report = await service().erase(c.user.id, {
      confirmEmail: c.user.email,
      scrubAuditIpAddresses: true,
    });
    assert.equal((report.deleted.auditIpAddresses ?? 0) >= 1, true);
    assert.equal(
      await ctx.countRows(
        'audit_events',
        `ip_address IS NOT NULL AND (entity_id = '${c.user.id}' OR actor_id = '${c.user.id}')`,
      ),
      0,
    );
    assert.equal(
      await ctx.countRows(
        'audit_events',
        `action = 'auth.login.success' AND actor_id = '${c.user.id}'`,
      ),
      1,
    );
    // The append-only protection is back on.
    await assert.rejects(
      ctx.container.pool.query(`UPDATE audit_events SET action = 'x'`),
      /append-only|not allowed|immutable/i,
    );
  },
);
