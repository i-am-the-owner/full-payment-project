import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createDatabasePool,
  type DatabasePool,
} from '../../../src/infrastructure/database/pool.ts';
import { loadMigrations, migrate } from '../../../src/infrastructure/database/migrator.ts';
import {
  TRANSFER_STATUSES,
  TRANSFER_TRANSITIONS,
} from '../../../src/domain/payout/transfer-status.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

// The database integration tests require a real PostgreSQL instance. When
// DATABASE_URL is not set (e.g. a plain `npm test` on a laptop) the whole suite
// is skipped rather than failing.
const suite = DATABASE_URL ? test : test.skip;

const silentLogger = { info: (): void => {} };
const SHARED_KEY = '00000000-0000-4000-8000-0000000000aa';

let pool: DatabasePool;

before(async () => {
  if (!DATABASE_URL) return;
  pool = createDatabasePool(DATABASE_URL);
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR), silentLogger);
});

after(async () => {
  if (pool) await pool.end();
});

/** Runs one statement in a transaction that declares where the status came from. */
async function withStatusSource(source: string, sql: string, params: unknown[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('almapay.status_source', $1, TRUE)`, [source]);
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Runs a status change the way the provider-evidence code path does. */
function asProvider(sql: string, params: unknown[]): Promise<void> {
  return withStatusSource('provider_webhook', sql, params);
}

beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(`
    TRUNCATE webhook_events, audit_events, transfer_events, provider_links, transfers,
             quote_fees, transfer_quotes, recipients, user_auth, users
    RESTART IDENTITY CASCADE
  `);
});

interface TransferGraph {
  userId: string;
  recipientId: string;
  corridorId: string;
  quoteId: string;
}

async function seedTransferGraph(): Promise<TransferGraph> {
  const { rows: corridorRows } = await pool.query<{ id: string }>(
    `SELECT id FROM corridors WHERE source_currency = 'GBP' AND destination_currency = 'KES'`,
  );
  const corridorId = corridorRows[0]!.id;

  const { rows: userRows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('sender@example.test') RETURNING id`,
  );
  const userId = userRows[0]!.id;

  const { rows: recipientRows } = await pool.query<{ id: string }>(
    `INSERT INTO recipients
       (user_id, display_name, account_holder_name, country_code, currency_code,
        account_summary, provider, provider_recipient_id)
     VALUES ($1, 'Amina', 'Amina Otieno', 'KE', 'KES', 'Acct ••••0000', 'mock', 'mock-recipient-1')
     RETURNING id`,
    [userId],
  );
  const recipientId = recipientRows[0]!.id;

  const { rows: quoteRows } = await pool.query<{ id: string }>(
    `INSERT INTO transfer_quotes
       (user_id, corridor_id, source_currency, destination_currency,
        source_amount_minor, fee_amount_minor, destination_amount_minor,
        exchange_rate, expires_at)
     VALUES ($1, $2, 'GBP', 'KES', 100000, 199, 17500000, 175.000000000000,
             now() + interval '15 minutes')
     RETURNING id`,
    [userId, corridorId],
  );
  const quoteId = quoteRows[0]!.id;

  return { userId, recipientId, corridorId, quoteId };
}

let transferSequence = 0;

async function insertTransfer(
  graph: TransferGraph,
  idempotencyKey = '00000000-0000-4000-8000-000000000001',
): Promise<string> {
  transferSequence += 1;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO transfers
       (reference, user_id, recipient_id, quote_id, corridor_id, idempotency_key,
        source_currency, destination_currency, source_amount_minor, fee_amount_minor,
        total_to_pay_minor, destination_amount_minor, exchange_rate)
     VALUES ($1, $2, $3, $4, $5, $6, 'GBP', 'KES', 100000, 199, 100199, 17500000, 175.0)
     RETURNING id`,
    [
      `ALM-TEST-${transferSequence}`,
      graph.userId,
      graph.recipientId,
      graph.quoteId,
      graph.corridorId,
      idempotencyKey,
    ],
  );
  return rows[0]!.id;
}

suite('seed reference data for the UK -> Kenya corridor exists', async () => {
  const countries = await pool.query(`SELECT code FROM countries ORDER BY code`);
  assert.deepEqual(
    countries.rows.map((r) => (r as { code: string }).code),
    ['GB', 'KE'],
  );

  // The table also caches whatever currencies the active provider has reported.
  const currencies = await pool.query(
    `SELECT code FROM currencies WHERE code IN ('GBP', 'KES') ORDER BY code`,
  );
  assert.deepEqual(
    currencies.rows.map((r) => (r as { code: string }).code),
    ['GBP', 'KES'],
  );

  const corridor = await pool.query(
    `SELECT 1 FROM corridors WHERE source_country = 'GB' AND destination_country = 'KE'`,
  );
  assert.equal(corridor.rowCount, 1);

  const transitions = await pool.query(
    `SELECT count(*)::int AS n FROM transfer_status_transitions`,
  );
  assert.equal((transitions.rows[0] as { n: number }).n, TRANSFER_TRANSITIONS.length);
});

suite('monetary columns never use floating-point types', async () => {
  const { rows } = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (column_name LIKE '%!_minor' ESCAPE '!' OR column_name = 'exchange_rate')`,
  );

  assert.ok(rows.length > 0);
  for (const row of rows) {
    const allowed = row.column_name === 'exchange_rate' ? ['numeric'] : ['bigint', 'integer'];
    assert.ok(
      allowed.includes(row.data_type),
      `${row.column_name} is ${row.data_type}, expected one of ${allowed.join('/')}`,
    );
  }
});

suite('BIGINT money is returned as a string, not a lossy number', async () => {
  const graph = await seedTransferGraph();
  const { rows } = await pool.query<{ total_to_pay_minor: unknown }>(
    `SELECT total_to_pay_minor FROM transfer_quotes WHERE id = $1`,
    [graph.quoteId],
  );
  assert.equal(typeof rows[0]!.total_to_pay_minor, 'string');
  assert.equal(rows[0]!.total_to_pay_minor, '100199');
});

suite('a quote whose currencies do not match its corridor is rejected', async () => {
  const graph = await seedTransferGraph();
  await assert.rejects(
    pool.query(
      `INSERT INTO transfer_quotes
         (user_id, corridor_id, source_currency, destination_currency,
          source_amount_minor, fee_amount_minor, destination_amount_minor,
          exchange_rate, expires_at)
       VALUES ($1, $2, 'KES', 'GBP', 100000, 199, 17500000, 175.0, now() + interval '15 minutes')`,
      [graph.userId, graph.corridorId],
    ),
    /do not match corridor/,
  );
});

suite('creating a transfer records an initial status-history row', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);

  const { rows } = await pool.query(
    `SELECT from_status, status FROM transfer_events WHERE transfer_id = $1`,
    [transferId],
  );
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { from_status: string | null }).from_status, null);
  assert.equal((rows[0] as { status: string }).status, 'DRAFT');
});

suite('a valid status transition is allowed and recorded', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);

  await asProvider(`UPDATE transfers SET status = 'AWAITING_FUNDS' WHERE id = $1`, [transferId]);

  const { rows } = await pool.query(
    `SELECT status FROM transfer_events WHERE transfer_id = $1 ORDER BY occurred_at`,
    [transferId],
  );
  assert.deepEqual(
    rows.map((r) => (r as { status: string }).status),
    ['DRAFT', 'AWAITING_FUNDS'],
  );
});

suite('an invalid status transition is rejected', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);

  await assert.rejects(
    asProvider(`UPDATE transfers SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [
      transferId,
    ]),
    /transition .* is not allowed/,
  );
});

suite('a terminal transfer cannot change status', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);

  await asProvider(`UPDATE transfers SET status = 'AWAITING_FUNDS' WHERE id = $1`, [transferId]);
  await pool.query(
    `UPDATE transfers SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`,
    [transferId],
  );

  await assert.rejects(
    asProvider(`UPDATE transfers SET status = 'PROCESSING' WHERE id = $1`, [transferId]),
    /terminal status/,
  );
});

suite('immutable financial fields on a transfer are frozen', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);

  await assert.rejects(
    pool.query(`UPDATE transfers SET source_amount_minor = 1 WHERE id = $1`, [transferId]),
    /immutable financial fields/,
  );
});

suite('transfer creation is idempotent per user and idempotency key', async () => {
  const graph = await seedTransferGraph();
  await insertTransfer(graph, SHARED_KEY);

  await assert.rejects(insertTransfer(graph, SHARED_KEY), /transfers_idempotency/);
});

suite('a negative transfer amount is rejected by a check constraint', async () => {
  const graph = await seedTransferGraph();
  await assert.rejects(
    pool.query(
      `INSERT INTO transfers
         (reference, user_id, recipient_id, quote_id, corridor_id, idempotency_key,
          source_currency, destination_currency, source_amount_minor, fee_amount_minor,
          total_to_pay_minor, destination_amount_minor, exchange_rate)
       VALUES ('ALM-neg', $1, $2, $3, $4, '00000000-0000-4000-8000-00000000000e', 'GBP', 'KES', -100, 0, -100, 1, 175.0)`,
      [graph.userId, graph.recipientId, graph.quoteId, graph.corridorId],
    ),
    /transfers_amounts_positive/,
  );
});

suite('duplicate webhook deliveries are rejected', async () => {
  await pool.query(
    `INSERT INTO webhook_events
       (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload)
     VALUES ('mock', 'evt_1', 'hash_1', 'transfers#state-change', true, '{}'::jsonb)`,
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO webhook_events
         (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload)
       VALUES ('mock', 'evt_1', 'hash_other', 'transfers#state-change', true, '{}'::jsonb)`,
    ),
    /webhook_events_provider_event_unique/,
  );
});

suite('a webhook cannot be marked processed without signature verification', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO webhook_events
         (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload,
          processing_status, processed_at)
       VALUES ('mock', 'evt_2', 'evt_2', 'transfers#state-change', false, '{}'::jsonb,
               'processed', now())`,
    ),
    /webhook_events_processed_requires_verification/,
  );
});

suite('audit events are append-only', async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO audit_events (actor_type, action, entity_type, entity_id)
     VALUES ('system', 'transfer.created', 'transfer', '00000000-0000-0000-0000-000000000000')
     RETURNING id`,
  );

  await assert.rejects(
    pool.query(`UPDATE audit_events SET action = 'tampered' WHERE id = $1`, [rows[0]!.id]),
    /append-only/,
  );
  await assert.rejects(
    pool.query(`DELETE FROM audit_events WHERE id = $1`, [rows[0]!.id]),
    /append-only/,
  );
});

// --- Provider-neutral layer (migration 0014) --------------------------------

suite('the database state machine is identical to the one in the domain code', async () => {
  const { rows } = await pool.query<{
    from_status: string;
    to_status: string;
    requires_provider_evidence: boolean;
  }>(`SELECT from_status, to_status, requires_provider_evidence FROM transfer_status_transitions`);
  const key = (from: string, to: string, evidence: boolean): string => `${from}>${to}:${evidence}`;
  assert.deepEqual(
    rows.map((r) => key(r.from_status, r.to_status, r.requires_provider_evidence)).sort(),
    TRANSFER_TRANSITIONS.map((t) => key(t.from, t.to, t.requiresProviderEvidence)).sort(),
  );

  const statuses = await pool.query<{ code: string }>(`SELECT code FROM transfer_statuses`);
  assert.deepEqual(statuses.rows.map((r) => r.code).sort(), [...TRANSFER_STATUSES].sort());
});

suite('a provider-confirmed status cannot be set without provider evidence', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);

  // A plain UPDATE – what an admin tool, a new endpoint or a console would do.
  await assert.rejects(
    pool.query(`UPDATE transfers SET status = 'AWAITING_FUNDS' WHERE id = $1`, [transferId]),
    /requires provider evidence/,
  );
  // A made-up source is not evidence either.
  await assert.rejects(
    withStatusSource('admin', `UPDATE transfers SET status = 'AWAITING_FUNDS' WHERE id = $1`, [
      transferId,
    ]),
    /requires provider evidence/,
  );
});

suite(
  'only provider evidence can correct a FAILED transfer, and the source is recorded',
  async () => {
    const graph = await seedTransferGraph();
    const transferId = await insertTransfer(graph);
    // SomPay may fail a transfer on its own authority...
    await pool.query(`UPDATE transfers SET status = 'FAILED', failed_at = now() WHERE id = $1`, [
      transferId,
    ]);

    // ...but nobody without provider evidence can take it out of FAILED.
    for (const status of ['PROCESSING', 'SENT', 'COMPLETED', 'REFUNDED', 'CANCELLED', 'DRAFT']) {
      await assert.rejects(
        pool.query(
          `UPDATE transfers SET status = $2, completed_at = now(), refunded_at = now(),
                cancelled_at = now() WHERE id = $1`,
          [transferId, status],
        ),
        /requires provider evidence|is not allowed/,
        status,
      );
    }

    await withStatusSource(
      'provider_lookup',
      `UPDATE transfers SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
      [transferId],
    );
    const { rows } = await pool.query<{
      from_status: string;
      status: string;
      source: string;
    }>(
      `SELECT from_status, status, source FROM transfer_events
     WHERE transfer_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [transferId],
    );
    assert.deepEqual(rows[0], {
      from_status: 'FAILED',
      status: 'COMPLETED',
      source: 'POLL',
    });
  },
);

suite('the evidence declaration does not leak to later statements on the connection', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('almapay.status_source', 'provider_webhook', TRUE)`);
    await client.query(`UPDATE transfers SET status = 'AWAITING_FUNDS' WHERE id = $1`, [
      transferId,
    ]);
    await client.query('COMMIT');
    // Same connection, next transaction: the declaration is gone.
    await assert.rejects(
      client.query(`UPDATE transfers SET status = 'PROCESSING' WHERE id = $1`, [transferId]),
      /requires provider evidence/,
    );
  } finally {
    client.release();
  }
});

suite('recipients hold a summary only: there is nowhere to store bank details', async () => {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'recipients'`,
  );
  const columns = rows.map((r) => r.column_name);
  for (const gone of ['bank_account_number', 'bank_code', 'bank_name', 'iban', 'mobile_number']) {
    assert.equal(columns.includes(gone), false, `${gone} must not exist`);
  }
  assert.ok(columns.includes('account_summary'));
  assert.ok(columns.includes('provider_recipient_id'));
});

suite('provider columns accept every supported provider and nothing else', async () => {
  for (const provider of ['mock', 'wise', 'airwallex', 'currencycloud']) {
    await pool.query(
      `INSERT INTO webhook_events
         (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload)
       VALUES ($1, $2, $2, 'transfer.status_changed', true, '{}'::jsonb)`,
      [provider, `evt-${provider}`],
    );
  }
  await assert.rejects(
    pool.query(
      `INSERT INTO webhook_events
         (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload)
       VALUES ('paypal', 'evt-x', 'evt-x', 'x', true, '{}'::jsonb)`,
    ),
    /webhook_events_provider_valid/,
  );
});

// --- Data model (migrations 0015 to 0017) ------------------------------------

async function insertUser(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0]!.id;
}

suite('users carry optional profile fields, with format checks', async () => {
  const id = await insertUser('profile@example.test');
  await pool.query(
    `UPDATE users SET phone = '+447700900123', first_name = 'Ada', last_name = 'Lovelace',
            date_of_birth = '1990-01-01', country_of_residence = 'GB' WHERE id = $1`,
    [id],
  );
  await assert.rejects(
    pool.query(`UPDATE users SET phone = '07700 900123' WHERE id = $1`, [id]),
    /users_phone_e164/,
  );
  await assert.rejects(
    pool.query(`UPDATE users SET country_of_residence = 'gb' WHERE id = $1`, [id]),
    /users_country_of_residence_format/,
  );
  await assert.rejects(
    pool.query(`UPDATE users SET date_of_birth = now() + interval '1 day' WHERE id = $1`, [id]),
    /users_date_of_birth_in_past/,
  );
});

suite('a user has at most one link per provider, and may be linked to several', async () => {
  const id = await insertUser('links@example.test');
  const link = `INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status)
                VALUES ($1, $2, $3, $4)`;
  await pool.query(link, [id, 'mock', 'mock-cust-1', 'VERIFIED']);
  await pool.query(link, [id, 'wise', 'wise-cust-1', 'PENDING']);

  await assert.rejects(
    pool.query(link, [id, 'mock', 'mock-cust-2', 'PENDING']),
    /provider_links_user_provider_unique/,
  );
  // One provider customer cannot belong to two SomPay users.
  const other = await insertUser('other@example.test');
  await assert.rejects(
    pool.query(link, [other, 'mock', 'mock-cust-1', 'PENDING']),
    /provider_links_provider_customer_unique/,
  );
  await assert.rejects(
    pool.query(link, [other, 'paypal', 'x', 'PENDING']),
    /provider_links_provider_valid/,
  );
  await assert.rejects(
    pool.query(link, [other, 'mock', 'mock-cust-9', 'verified']),
    /provider_links_kyc_status_valid/,
  );
});

suite('a stored token always records the key version that encrypted it', async () => {
  const id = await insertUser('token@example.test');
  await pool.query(
    `INSERT INTO provider_links (user_id, provider, provider_customer_id) VALUES ($1, 'mock', 'c')`,
    [id],
  );
  await assert.rejects(
    pool.query(`UPDATE provider_links SET encrypted_refresh_token = 'abc' WHERE user_id = $1`, [
      id,
    ]),
    /provider_links_token_has_key_version/,
  );
  await pool.query(
    `UPDATE provider_links SET encrypted_refresh_token = 'abc', token_key_version = 1
     WHERE user_id = $1`,
    [id],
  );
});

suite('new transfers need a UUID idempotency key, unique across all users', async () => {
  const graph = await seedTransferGraph();
  await assert.rejects(insertTransfer(graph, 'not-a-uuid'), /transfers_idempotency_key_is_uuid/);

  await insertTransfer(graph, SHARED_KEY);
  // The same UUID under a different user is still a duplicate.
  const otherUser = await insertUser('second@example.test');
  await assert.rejects(
    pool.query(
      `INSERT INTO transfers
         (reference, user_id, recipient_id, quote_id, idempotency_key,
          source_currency, destination_currency, source_amount_minor, fee_amount_minor,
          total_to_pay_minor, destination_amount_minor, exchange_rate)
       VALUES ('ALM-other', $1, $2, $3, $4, 'GBP', 'KES', 100, 0, 100, 1, 175.0)`,
      [otherUser, graph.recipientId, graph.quoteId, SHARED_KEY.toUpperCase()],
    ),
    /transfers_idempotency_key_uuid_unique|transfers_one_per_quote/,
  );
});

suite('funding method accepts only the known methods', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);
  await pool.query(`UPDATE transfers SET funding_method = 'BANK_TRANSFER' WHERE id = $1`, [
    transferId,
  ]);
  await assert.rejects(
    pool.query(`UPDATE transfers SET funding_method = 'CARD' WHERE id = $1`, [transferId]),
    /transfers_funding_method_valid/,
  );
});

suite('transfer events record who caused each status and cannot be edited', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);
  await withStatusSource(
    'user',
    `UPDATE transfers SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`,
    [transferId],
  );
  const { rows } = await pool.query<{ status: string; source: string }>(
    `SELECT status, source FROM transfer_events WHERE transfer_id = $1 ORDER BY occurred_at`,
    [transferId],
  );
  assert.deepEqual(rows, [
    { status: 'DRAFT', source: 'SYSTEM' },
    { status: 'CANCELLED', source: 'USER' },
  ]);

  await assert.rejects(
    pool.query(`UPDATE transfer_events SET source = 'ADMIN' WHERE transfer_id = $1`, [transferId]),
    /append-only|immutable|not allowed/i,
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO transfer_events (transfer_id, status, source) VALUES ($1, 'DRAFT', 'ROBOT')`,
      [transferId],
    ),
    /transfer_events_source_valid/,
  );
});

suite('no money column uses a floating-point type', async () => {
  const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type IN ('real', 'double precision', 'money')`,
  );
  assert.deepEqual(rows, []);

  const money = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name LIKE '%!_minor' ESCAPE '!'`,
  );
  assert.ok(money.rows.length >= 8);
  assert.ok(money.rows.every((r) => r.data_type === 'bigint'));
});

suite('required indexes exist', async () => {
  const { rows } = await pool.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const defs = rows.map((r) => r.indexdef);
  const has = (table: string, columns: string): boolean =>
    defs.some((d) => d.includes(` ON public.${table} `) && d.includes(`(${columns}`));

  assert.ok(has('transfers', 'user_id, created_at'), 'transfers(user_id, created_at)');
  assert.ok(
    has('transfers', 'provider, provider_transfer_id'),
    'transfers(provider, provider_transfer_id)',
  );
  assert.ok(
    has('webhook_events', 'provider, provider_event_id'),
    'webhook_events(provider, provider_event_id)',
  );
  // Foreign keys.
  assert.ok(has('transfers', 'recipient_id'));
  assert.ok(has('transfers', 'quote_id'));
  assert.ok(has('recipients', 'user_id'));
  assert.ok(has('transfer_quotes', 'user_id'));
  assert.ok(has('transfer_events', 'transfer_id'));
  assert.ok(has('provider_links', 'user_id'));
});

suite('a link can exist before the provider gives a customer id, but never VERIFIED', async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('onboarding-schema@example.test') RETURNING id`,
  );
  const userId = rows[0]!.id;
  await pool.query(
    `INSERT INTO provider_links (user_id, provider, kyc_status) VALUES ($1, 'mock', 'PENDING')`,
    [userId],
  );
  await assert.rejects(
    pool.query(`UPDATE provider_links SET kyc_status = 'VERIFIED' WHERE user_id = $1`, [userId]),
    /provider_links_verified_has_customer/,
  );
  await pool.query(
    `UPDATE provider_links SET kyc_status = 'REJECTED_PENDING_REVIEW' WHERE user_id = $1`,
    [userId],
  );
  await assert.rejects(
    pool.query(`UPDATE provider_links SET kyc_status = 'APPROVED' WHERE user_id = $1`, [userId]),
    /provider_links_kyc_status_valid/,
  );
});

suite('onboarding states are unique, tied to a user and a known provider', async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('onboarding-state@example.test') RETURNING id`,
  );
  const userId = rows[0]!.id;
  const insert = (provider: string, hash: string) =>
    pool.query(
      `INSERT INTO onboarding_states (user_id, provider, state_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [userId, provider, hash],
    );
  await insert('mock', 'hash-1');
  await assert.rejects(insert('mock', 'hash-1'), /onboarding_states_hash_unique/);
  await assert.rejects(insert('paypal', 'hash-2'), /onboarding_states_provider_valid/);

  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  const left = await pool.query(`SELECT 1 FROM onboarding_states WHERE user_id = $1`, [userId]);
  assert.equal(left.rows.length, 0);
});

suite(
  'a TOTP secret always records its key version, and cannot be enabled without a secret',
  async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ('totp-schema@example.test') RETURNING id`,
    );
    const userId = rows[0]!.id;
    await pool.query(
      `INSERT INTO user_auth (user_id, password_algorithm) VALUES ($1, 'argon2id')`,
      [userId],
    );
    await assert.rejects(
      pool.query(`UPDATE user_auth SET totp_secret_encrypted = 'x' WHERE user_id = $1`, [userId]),
      /user_auth_totp_secret_has_key_version/,
    );
    await assert.rejects(
      pool.query(`UPDATE user_auth SET totp_enabled_at = now() WHERE user_id = $1`, [userId]),
      /user_auth_totp_enabled_has_secret/,
    );
  },
);

suite(
  'webhook deliveries that failed verification can be stored, and never as processed',
  async () => {
    await pool.query(
      `INSERT INTO webhook_events (provider, provider_event_id, dedupe_key, event_type,
       signature_verified, payload, processing_status, processing_error, processed_at)
     VALUES ('mock', 'invalid:1', 'invalid:1', 'unverified', FALSE, '{}', 'failed', 'invalid_signature', now())`,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO webhook_events (provider, provider_event_id, dedupe_key, event_type,
         signature_verified, payload, processing_status, processed_at)
       VALUES ('mock', 'invalid:2', 'invalid:2', 'x', FALSE, '{}', 'processed', now())`,
      ),
      /webhook_events_processed_requires_verification/,
    );
  },
);

suite(
  'one customer notification per transfer and kind; one open admin alert per problem',
  async () => {
    const graph = await seedTransferGraph();
    const transferId = await insertTransfer(graph);
    const insert = (kind: string) =>
      pool.query(
        `INSERT INTO transfer_notifications (transfer_id, user_id, kind) VALUES ($1, $2, $3)`,
        [transferId, graph.userId, kind],
      );
    await insert('DELIVERED');
    await assert.rejects(insert('DELIVERED'), /transfer_notifications_once/);
    await assert.rejects(insert('TELEGRAM'), /transfer_notifications_kind_valid/);

    const alert = (status: string) =>
      pool.query(
        `INSERT INTO admin_alerts (kind, entity_type, entity_id, message, status, resolved_at)
       VALUES ('K', 'transfer', 'e1', 'm', $1, CASE WHEN $1 = 'resolved' THEN now() END)`,
        [status],
      );
    await alert('open');
    await assert.rejects(alert('open'), /admin_alerts_open_idx/);
    await alert('resolved');
    await alert('resolved');
  },
);

suite('job rows only accept known states and a positive attempt budget', async () => {
  await assert.rejects(
    pool.query(`INSERT INTO jobs (type, status) VALUES ('t', 'lost')`),
    /jobs_status_valid/,
  );
  await assert.rejects(
    pool.query(`INSERT INTO jobs (type, max_attempts) VALUES ('t', 0)`),
    /jobs_attempts_valid/,
  );
});

suite('ignored provider events are recorded on a transfer without changing it', async () => {
  const graph = await seedTransferGraph();
  const transferId = await insertTransfer(graph);
  await pool.query(
    `INSERT INTO transfer_events (transfer_id, from_status, status, reason, source, applied)
     SELECT id, status, 'PROCESSING', 'out_of_order', 'WEBHOOK', FALSE FROM transfers WHERE id = $1`,
    [transferId],
  );
  const { rows } = await pool.query<{ applied: boolean }>(
    `SELECT applied FROM transfer_events WHERE transfer_id = $1 ORDER BY occurred_at`,
    [transferId],
  );
  assert.deepEqual(
    rows.map((r) => r.applied),
    [true, false],
  );
  const t = await pool.query<{ status: string }>(`SELECT status FROM transfers WHERE id = $1`, [
    transferId,
  ]);
  assert.equal(t.rows[0]?.status, 'DRAFT');
  await assert.rejects(
    pool.query(`UPDATE transfer_events SET applied = TRUE WHERE transfer_id = $1`, [transferId]),
    /append-only|not allowed|immutable/i,
  );
});
