import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';
import type { MockTransferStatus } from '../../../src/infrastructure/providers/mock/mock-status-mapping.ts';
import { RecordingMailer } from '../../support/transfer-fakes.ts';

/**
 * Reliable status updates end to end: signed webhooks over HTTP into a real
 * database, processed by the background worker, with notifications, alerts,
 * the safety-net poll and the dev tools.
 */

const suite = DATABASE_URL ? test : test.skip;
type Json = Record<string, unknown>;

const EUR_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

let ctx: TestContext;
let mock: MockPayoutProvider;
const mailer = new RecordingMailer();

before(async () => {
  if (!DATABASE_URL) return;
  mock = new MockPayoutProvider({ webhookSecret: 'integration-mock-secret-0123456789' });
  ctx = await startTestContext({ payoutProvider: mock, mailer });
});
after(async () => {
  if (ctx) await ctx.close();
});
beforeEach(async () => {
  if (!ctx) return;
  await ctx.reset();
  await ctx.container.pool.query(`TRUNCATE jobs, admin_alerts, webhook_events`);
  mailer.notices.length = 0;
});

interface Session {
  userId: string;
  token: string;
}
async function session(): Promise<Session> {
  const user = await ctx.createUser();
  return { userId: user.id, token: await ctx.issueToken(user.id) };
}
function call(
  s: Session,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return ctx.http(path, {
    method,
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const data = (res: { body: unknown }): Json => (res.body as { data: Json }).data;

let keyCounter = 0;
async function newTransfer(s: Session): Promise<{ id: string; providerId: string }> {
  const quote = data(
    await call(s, 'POST', '/api/v1/quotes', {
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmount: '100.00',
    }),
  );
  const recipient = data(
    await call(s, 'POST', '/api/v1/recipients', {
      currency: 'EUR',
      country: 'DE',
      values: EUR_VALUES,
    }),
  );
  keyCounter += 1;
  const created = await call(
    s,
    'POST',
    '/api/v1/transfers',
    { quoteId: quote.id, recipientId: recipient.id, answers: { purpose: 'family_support' } },
    { 'idempotency-key': `00000000-0000-4000-8000-${String(900 + keyCounter).padStart(12, '0')}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = String(data(created).id);
  const { rows } = await ctx.container.pool.query<{ provider_transfer_id: string }>(
    `SELECT provider_transfer_id FROM transfers WHERE id = $1`,
    [id],
  );
  return { id, providerId: rows[0]!.provider_transfer_id };
}

/** POSTs a webhook to the real endpoint, exactly as a provider would. */
async function post(webhook: { headers: Record<string, string | undefined>; rawBody: Buffer }) {
  const response = await fetch(`${ctx.baseUrl}/webhooks/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(webhook.headers as Record<string, string>) },
    body: webhook.rawBody,
  });
  return { status: response.status, body: (await response.json()) as Json };
}
const drain = (): Promise<number> => ctx.container.background.runner.drain();

async function detail(s: Session, id: string) {
  const res = data(await call(s, 'GET', `/api/v1/transfers/${id}`));
  return {
    status: res.status as string,
    timeline: (res.timeline as Json[]).map((e) => e.status as string),
  };
}
async function walk(providerId: string, steps: readonly [MockTransferStatus, number?][]) {
  const now = Date.now();
  for (const [status, minutesAgo = 0] of steps) {
    const webhook = mock.simulateTransferEvent(providerId, status, {
      occurredAt: new Date(now - minutesAgo * 60_000),
    });
    assert.equal((await post(webhook)).status, 200);
    await drain();
  }
}

// --- Every status, end to end -------------------------------------------------------

suite('simulating every status updates the timeline and sends the right notification', async () => {
  const s = await session();

  // The happy path.
  const happy = await newTransfer(s);
  assert.deepEqual((await detail(s, happy.id)).timeline, ['DRAFT', 'AWAITING_FUNDS']);
  await walk(happy.providerId, [['pending_funding'], ['funded'], ['paid_out'], ['delivered']]);
  assert.deepEqual(await detail(s, happy.id), {
    status: 'COMPLETED',
    timeline: ['DRAFT', 'AWAITING_FUNDS', 'PROCESSING', 'SENT', 'COMPLETED'],
  });
  assert.deepEqual(mailer.kinds(), ['FUNDS_RECEIVED', 'SENT', 'DELIVERED']);
  const delivered = mailer.notices.at(-1)!;
  assert.match(delivered.notice.subject, /Anna Schmidt has received 115\.94 EUR/);
  assert.equal(delivered.to.endsWith('@example.test'), true);

  // Cancelled before any money was taken.
  mailer.notices.length = 0;
  const cancelled = await newTransfer(s);
  await walk(cancelled.providerId, [['cancelled']]);
  assert.equal((await detail(s, cancelled.id)).status, 'CANCELLED');
  assert.deepEqual(mailer.kinds(), ['CANCELLED']);

  // Paid out, bounced back, then refunded.
  mailer.notices.length = 0;
  const bounced = await newTransfer(s);
  await walk(bounced.providerId, [['funded'], ['paid_out'], ['rejected'], ['returned']]);
  assert.deepEqual(await detail(s, bounced.id), {
    status: 'REFUNDED',
    timeline: ['DRAFT', 'AWAITING_FUNDS', 'PROCESSING', 'SENT', 'FAILED', 'REFUNDED'],
  });
  assert.deepEqual(mailer.kinds(), ['FUNDS_RECEIVED', 'SENT', 'FAILED', 'REFUNDED']);
  assert.match(mailer.notices[2]!.notice.text, /Your money is not lost/);
});

suite('the webhook is acknowledged before it is processed; the worker applies it', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);
  const webhook = mock.simulateTransferEvent(providerId, 'funded');

  const ack = await post(webhook);
  assert.deepEqual(ack, { status: 200, body: { status: 'received' } });
  assert.equal((await detail(s, id)).status, 'AWAITING_FUNDS', 'not applied inside the request');
  assert.equal(await ctx.countRows('jobs', `type = 'process_webhook' AND status = 'queued'`), 1);

  await drain();
  assert.equal((await detail(s, id)).status, 'PROCESSING');
  assert.equal(await ctx.countRows('webhook_events', `processing_status = 'processed'`), 1);
});

// --- Signatures and duplicates ----------------------------------------------------------

suite('a bad signature is a 401, is recorded without its body, and changes nothing', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);
  const webhook = mock.simulateTransferEvent(providerId, 'delivered');
  ctx.logLines.length = 0;

  assert.equal((await post({ headers: {}, rawBody: webhook.rawBody })).status, 401);
  const tampered = Buffer.from(webhook.rawBody.toString().replace('delivered', 'funded'));
  assert.equal((await post({ headers: webhook.headers, rawBody: tampered })).status, 401);
  await drain();

  assert.equal((await detail(s, id)).status, 'AWAITING_FUNDS');
  assert.equal(await ctx.countRows('jobs'), 0);
  const { rows } = await ctx.container.pool.query<{
    signature_verified: boolean;
    event_type: string;
    payload: Json;
    processing_status: string;
  }>(`SELECT signature_verified, event_type, payload, processing_status FROM webhook_events`);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.signature_verified, false);
    assert.equal(row.processing_status, 'failed');
    assert.deepEqual(Object.keys(row.payload).sort(), ['bodyBytes', 'bodySha256']);
  }
});

suite('a rejected webhook is logged as a warning that never contains the body', async () => {
  const s = await session();
  const { providerId } = await newTransfer(s);
  const noisy = await startTestContext({
    payoutProvider: mock,
    envOverrides: { LOG_LEVEL: 'warn' },
  });
  try {
    const webhook = mock.simulateTransferEvent(providerId, 'delivered');
    for (const headers of [{}, { 'x-mock-signature': 'deadbeef' }]) {
      const response = await fetch(`${noisy.baseUrl}/webhooks/mock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: webhook.rawBody,
      });
      assert.equal(response.status, 401);
    }
    const logged = noisy.logLines.filter((l) => l.includes('provider.webhook.invalid_signature'));
    assert.equal(logged.length, 2);
    for (const line of logged) {
      assert.ok(
        !line.includes(providerId) && !line.includes('delivered') && !line.includes('transfer_id'),
      );
      assert.match(line, /"bodyBytes":\d+/);
    }
  } finally {
    await noisy.close();
  }
});

suite('a duplicate event is acknowledged and does nothing', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);
  const webhook = mock.simulateTransferEvent(providerId, 'funded');

  assert.equal((await post(webhook)).body.status, 'received');
  assert.equal((await post(webhook)).body.status, 'duplicate'); // before it was processed
  await drain();
  assert.equal((await post(webhook)).body.status, 'duplicate'); // after
  await drain();

  assert.equal((await detail(s, id)).status, 'PROCESSING');
  assert.equal(await ctx.countRows('webhook_events'), 1);
  assert.equal(await ctx.countRows('jobs', `type = 'process_webhook'`), 1);
  assert.equal(
    await ctx.countRows(
      'audit_events',
      `action = 'transfer.status_changed' AND entity_id = '${id}'`,
    ),
    1,
  );
  assert.deepEqual(mailer.kinds(), ['FUNDS_RECEIVED']);
});

// --- Forward only -----------------------------------------------------------------------

suite('an out-of-order event does not move the status backwards, but is recorded', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);

  // "paid out" (newer) is processed first; "funded" (older) arrives afterwards.
  await walk(providerId, [
    ['paid_out', 0],
    ['funded', 5],
  ]);
  assert.equal((await detail(s, id)).status, 'SENT');

  // The customer's timeline shows what happened; the record keeps what was ignored.
  assert.deepEqual((await detail(s, id)).timeline, ['DRAFT', 'AWAITING_FUNDS', 'SENT']);
  const { rows } = await ctx.container.pool.query<{
    status: string;
    applied: boolean;
    reason: string;
    source: string;
  }>(
    `SELECT status, applied, reason, source FROM transfer_events WHERE transfer_id = $1 AND NOT applied`,
    [id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'PROCESSING');
  assert.equal(rows[0]?.source, 'WEBHOOK');
  assert.match(rows[0]?.reason ?? '', /out_of_order|invalid_transition/);

  // A legal step that is nevertheless older than what was applied is ignored too.
  await walk(providerId, [
    ['delivered', 0],
    ['rejected', 10],
  ]);
  assert.equal((await detail(s, id)).status, 'COMPLETED');
  assert.equal(
    await ctx.countRows(
      'transfer_events',
      `transfer_id = '${id}' AND NOT applied AND reason = 'out_of_order'`,
    ),
    2,
  );
  assert.deepEqual(await ctx.container.adminAlerts.list({ status: 'open', limit: 10 }), []);
});

suite('events are applied in order even when two arrive at the same moment', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);
  const now = Date.now();
  for (const [status, ago] of [
    ['paid_out', 0],
    ['funded', 3],
  ] as const) {
    await post(
      mock.simulateTransferEvent(providerId, status, { occurredAt: new Date(now - ago * 60_000) }),
    );
  }
  // Two workers racing for the two queued jobs.
  await Promise.all([drain(), drain()]);
  assert.equal((await detail(s, id)).status, 'SENT');
});

// --- Unknown transfers and admin alerts ---------------------------------------------------

suite(
  'an unknown transfer is retried, then recorded as failed and raised to an admin',
  async () => {
    const stranger = mock.simulateTransferEvent('mock-transfer-nobody', 'delivered');
    assert.equal((await post(stranger)).status, 200);
    await drain();
    assert.equal(await ctx.countRows('jobs', `status = 'queued' AND attempts = 1`), 1);
    assert.equal(await ctx.countRows('admin_alerts'), 0, 'not yet: it may still arrive');

    // Skip the wait: this is the last attempt.
    await ctx.container.pool.query(
      `UPDATE jobs SET max_attempts = 2, run_at = now() - interval '1 second'`,
    );
    await drain();
    assert.equal(
      await ctx.countRows(
        'webhook_events',
        `processing_status = 'failed' AND processing_error = 'unknown_transfer'`,
      ),
      1,
    );
    assert.equal(await ctx.countRows('jobs', `status = 'done'`), 1);

    const alerts = await ctx.container.adminAlerts.list({ status: 'open', limit: 10 });
    assert.deepEqual(
      alerts.map((a) => `${a.kind}:${a.entityId}`),
      ['UNKNOWN_PROVIDER_TRANSFER:mock-transfer-nobody'],
    );
  },
);

suite(
  'a payout that fails after funding is flagged for an admin, who can see and resolve it',
  async () => {
    const s = await session();
    const { id, providerId } = await newTransfer(s);
    await walk(providerId, [['funded'], ['paid_out'], ['rejected']]);

    const admin = await ctx.createUser();
    const adminToken = await ctx.issueToken(admin.id, ['admin']);
    const listed = await ctx.http('/api/v1/admin/alerts', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const alerts = data(listed).alerts as Json[];
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.kind, 'PAYOUT_FAILED_AFTER_FUNDING');
    assert.equal(alerts[0]?.entityId, id);
    assert.equal(alerts[0]?.severity, 'high');
    assert.ok(!JSON.stringify(alerts).includes('Anna') && !JSON.stringify(alerts).includes('DE89'));

    // A customer cannot see them.
    assert.equal((await call(s, 'GET', '/api/v1/admin/alerts')).status, 403);
    assert.equal(
      (await call(s, 'POST', `/api/v1/admin/alerts/${String(alerts[0]?.id)}/resolve`, {})).status,
      403,
    );

    const resolve = await ctx.http(`/api/v1/admin/alerts/${String(alerts[0]?.id)}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(resolve.status, 200);
    assert.equal(
      (
        data(
          await ctx.http('/api/v1/admin/alerts', {
            headers: { authorization: `Bearer ${adminToken}` },
          }),
        ).alerts as Json[]
      ).length,
      0,
    );
    assert.equal(
      (
        await ctx.http(`/api/v1/admin/alerts/${String(alerts[0]?.id)}/resolve`, {
          method: 'POST',
          headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      404,
    );
  },
);

// --- Redaction ----------------------------------------------------------------------------------

suite(
  'personal data in a webhook is redacted before it is stored on the event or the transfer',
  async () => {
    const s = await session();
    const { id, providerId } = await newTransfer(s);
    const webhook = mock.signWebhook({
      event: 'transfer.updated',
      event_id: 'evt-pii',
      transfer_id: providerId,
      status: 'funded',
      occurred_at: new Date().toISOString(),
      beneficiary: { first_name: 'Anna', iban: 'DE89370400440532013000' },
      email: 'anna@example.test',
    });
    await post(webhook);
    await drain();

    const stored = await ctx.container.pool.query<{ p: string }>(
      `SELECT payload::text AS p FROM webhook_events
     UNION ALL SELECT raw_payload::text FROM transfer_events WHERE transfer_id = $1`,
      [id],
    );
    const everything = stored.rows.map((r) => r.p).join('\n');
    assert.ok(everything.includes('[redacted]'));
    for (const secret of ['Anna', 'DE89370400440532013000', 'anna@example.test']) {
      assert.ok(!everything.includes(secret), `${secret} must not be stored`);
    }
    assert.ok(everything.includes('evt-pii'), 'ids and statuses are kept');
  },
);

// --- The safety-net poll ---------------------------------------------------------------------------

suite('the poll finds a stuck transfer the webhook never reported (source POLL)', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);
  // The provider paid out; the webhook was lost. Nothing has changed for 45 minutes.
  mock.advanceTransfer(providerId, 'paid_out');
  await ctx.container.pool.query(`ALTER TABLE transfer_events DISABLE TRIGGER USER`);
  await ctx.container.pool.query(
    `UPDATE transfer_events SET occurred_at = now() - interval '45 minutes' WHERE transfer_id = $1`,
    [id],
  );
  await ctx.container.pool.query(`ALTER TABLE transfer_events ENABLE TRIGGER USER`);

  const summary = await ctx.container.background.pollStuckTransfers();
  assert.deepEqual(summary, { checked: 1, changed: 1, adopted: 0, errors: 0 });
  await drain();

  assert.equal((await detail(s, id)).status, 'SENT');
  const { rows } = await ctx.container.pool.query<{ source: string }>(
    `SELECT source FROM transfer_events WHERE transfer_id = $1 AND status = 'SENT'`,
    [id],
  );
  assert.deepEqual(rows, [{ source: 'POLL' }]);
  assert.deepEqual(mailer.kinds(), ['SENT']);

  // Polled just now: left alone until the minimum gap has passed.
  assert.equal((await ctx.container.background.pollStuckTransfers()).checked, 0);
});

suite('a transfer that changed recently is not polled', async () => {
  const s = await session();
  await newTransfer(s);
  assert.equal((await ctx.container.background.pollStuckTransfers()).checked, 0);
});

suite('the scheduled poll job runs through the same worker', async () => {
  const s = await session();
  const { id, providerId } = await newTransfer(s);
  mock.advanceTransfer(providerId, 'funded');
  await ctx.container.pool.query(`ALTER TABLE transfer_events DISABLE TRIGGER USER`);
  await ctx.container.pool.query(
    `UPDATE transfer_events SET occurred_at = now() - interval '2 hours' WHERE transfer_id = $1`,
    [id],
  );
  await ctx.container.pool.query(`ALTER TABLE transfer_events ENABLE TRIGGER USER`);

  await ctx.container.pool.query(
    `INSERT INTO jobs (type, dedupe_key) VALUES ('poll_stuck_transfers', 'schedule:test:1')`,
  );
  await drain();
  assert.equal((await detail(s, id)).status, 'PROCESSING');
  assert.equal(await ctx.countRows('jobs', `type = 'poll_stuck_transfers' AND status = 'done'`), 1);
});

// --- Customer (KYC) events --------------------------------------------------------------------------

suite(
  'a customer status webhook updates provider_links, and VERIFIED waits for the identity check',
  async () => {
    const user = await ctx.createUser({ providerVerified: false });
    const ref = `mock-pending-${user.id}`;
    await ctx.container.pool.query(
      `INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status) VALUES ($1, 'mock', $2, 'PENDING')`,
      [user.id, ref],
    );
    const status = async () =>
      (
        await ctx.container.pool.query<{ kyc_status: string }>(
          `SELECT kyc_status FROM provider_links WHERE user_id = $1`,
          [user.id],
        )
      ).rows[0]?.kyc_status;
    const send = async (s: 'verified' | 'rejected' | 'needs_relink', minutesAgo = 0) => {
      await post(
        mock.simulateCustomerStatus(ref, s, {
          occurredAt: new Date(Date.now() - minutesAgo * 60_000),
        }),
      );
      await drain();
    };

    await send('verified', 5);
    assert.equal(await status(), 'PENDING', 'no identity check yet');
    await ctx.container.pool.query(
      `UPDATE provider_links SET identity_checked_at = now() WHERE user_id = $1`,
      [user.id],
    );
    await send('verified', 4);
    assert.equal(await status(), 'VERIFIED');
    await send('rejected', 3);
    assert.equal(await status(), 'REJECTED');
    await send('verified', 4); // older than the rejection
    assert.equal(await status(), 'REJECTED');
    await send('needs_relink');
    assert.equal(await status(), 'NEEDS_RELINK');

    // A link held for review is never released by a webhook.
    await ctx.container.pool.query(
      `UPDATE provider_links SET kyc_status = 'REJECTED_PENDING_REVIEW' WHERE user_id = $1`,
      [user.id],
    );
    await send('verified');
    assert.equal(await status(), 'REJECTED_PENDING_REVIEW');
  },
);

// --- Dev tools ------------------------------------------------------------------------------------------

suite(
  'the dev endpoint sends signed test webhooks for any status, including duplicates and late ones',
  async () => {
    const s = await session();
    const { id } = await newTransfer(s);
    const send = (body: Json) => call(s, 'POST', `/dev/mock/transfers/${id}/webhook`, body);

    const funded = await send({ status: 'funded', times: 3 });
    assert.equal(funded.status, 200, JSON.stringify(funded.body));
    assert.deepEqual(data(funded).webhookOutcomes, ['received', 'duplicate', 'duplicate']);
    assert.equal(data(funded).status, 'PROCESSING');

    const late = await send({ status: 'pending_funding', secondsAgo: 600 });
    assert.equal(data(late).status, 'PROCESSING');
    assert.equal(
      await ctx.countRows('transfer_events', `transfer_id = '${id}' AND NOT applied`),
      1,
    );

    // "Advance" moves the mock provider itself: pending -> funded -> paid out.
    const advance = () => call(s, 'POST', `/dev/mock/transfers/${id}/advance`, {});
    assert.equal(data(await advance()).status, 'PROCESSING');
    assert.equal(data(await advance()).status, 'SENT');

    // Strict body: a status cannot be written directly.
    assert.equal((await send({ status: 'COMPLETED' })).status, 400);
    assert.equal((await send({ status: 'delivered', set: 'COMPLETED' })).status, 400);
  },
);
