import { parseEnv } from '../../config/env.ts';
import { createLogger } from '../../shared/logger.ts';
import { Argon2PasswordHasher } from '../auth/argon2-password-hasher.ts';
import { createDatabasePool, type DatabasePool } from './pool.ts';

/**
 * Development seed data: two customers, a few recipients and transfers, all on
 * the MOCK provider. Run with `npm run db:seed` after `npm run db:migrate`.
 *
 * - Refuses to run in production or when PAYOUT_PROVIDER is not `mock`.
 * - Safe to run twice: it does nothing if the seed customers already exist.
 * - Contains no secrets. The seed customers get a password only if you supply
 *   one in SEED_USER_PASSWORD; otherwise sign in via the password-reset flow.
 * - Everything is made-up test data. The mock provider keeps its own state in
 *   memory, so these transfers can be read and listed but not advanced,
 *   refreshed or cancelled through the mock – create new ones for that.
 */

const USERS = [
  {
    id: '5eed0000-0000-4000-8000-000000000001',
    email: 'seed.alice@almapay.example',
    firstName: 'Alice',
    lastName: 'Seed',
    phone: '+447700900001',
    dateOfBirth: '1990-04-12',
    country: 'GB',
    kyc: 'VERIFIED',
  },
  {
    id: '5eed0000-0000-4000-8000-000000000002',
    email: 'seed.bob@almapay.example',
    firstName: 'Bob',
    lastName: 'Seed',
    phone: '+447700900002',
    dateOfBirth: '1985-11-30',
    country: 'GB',
    kyc: 'PENDING',
  },
] as const;

const ALICE = USERS[0].id;

const RECIPIENTS = [
  {
    id: '5eed0000-0000-4000-8000-0000000000a1',
    name: 'Anna Schmidt',
    country: 'DE',
    currency: 'EUR',
    summary: 'IBAN ••••3000',
  },
  {
    id: '5eed0000-0000-4000-8000-0000000000a2',
    name: 'Priya Sharma',
    country: 'IN',
    currency: 'INR',
    summary: 'Acct ••••9012',
  },
  {
    id: '5eed0000-0000-4000-8000-0000000000a3',
    name: 'Luis Perez',
    country: 'MX',
    currency: 'MXN',
    summary: 'CLABE ••••9719',
  },
] as const;

/** One transfer per row; `path` is the statuses it passes through after DRAFT. */
const TRANSFERS = [
  {
    n: 1,
    recipient: 0,
    target: 'EUR',
    source: 9910,
    fee: 90,
    targetMinor: 11594,
    rate: '1.17',
    path: ['AWAITING_FUNDS', 'PROCESSING', 'SENT', 'COMPLETED'],
    method: 'BANK_TRANSFER',
  },
  {
    n: 2,
    recipient: 1,
    target: 'INR',
    source: 24850,
    fee: 150,
    targetMinor: 2621675,
    rate: '105.5',
    path: ['AWAITING_FUNDS', 'PROCESSING'],
    method: 'BANK_TRANSFER',
  },
  {
    n: 3,
    recipient: 2,
    target: 'MXN',
    source: 4930,
    fee: 70,
    targetMinor: 113883,
    rate: '23.1',
    path: ['AWAITING_FUNDS'],
    method: null,
  },
  {
    n: 4,
    recipient: 0,
    target: 'EUR',
    source: 19870,
    fee: 130,
    targetMinor: 23247,
    rate: '1.17',
    path: ['AWAITING_FUNDS', 'FAILED'],
    method: null,
  },
] as const;

const uuid = (kind: string, n: number): string =>
  `5eed0000-0000-4000-8000-${kind}${String(n).padStart(11, '0')}`;

async function seed(pool: DatabasePool, passwordHash: string | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO currencies (code, name, minor_unit, is_active) VALUES
         ('GBP', 'Pound sterling', 2, TRUE), ('EUR', 'Euro', 2, TRUE),
         ('INR', 'Indian rupee', 2, TRUE), ('MXN', 'Mexican peso', 2, TRUE)
       ON CONFLICT (code) DO NOTHING`,
    );

    for (const user of USERS) {
      await client.query(
        `INSERT INTO users (id, email, status, email_verified_at, first_name, last_name, phone,
                            date_of_birth, country_of_residence)
         VALUES ($1, $2, 'active', now(), $3, $4, $5, $6, $7)`,
        [
          user.id,
          user.email,
          user.firstName,
          user.lastName,
          user.phone,
          user.dateOfBirth,
          user.country,
        ],
      );
      await client.query(
        `INSERT INTO user_auth (user_id, password_hash, password_algorithm, password_updated_at)
         VALUES ($1, $2, 'argon2id', CASE WHEN $2::text IS NULL THEN NULL ELSE now() END)`,
        [user.id, passwordHash],
      );
      await client.query(
        `INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status)
         VALUES ($1, 'mock', $2, $3)`,
        [user.id, `mock-${user.kyc.toLowerCase()}-${user.id}`, user.kyc],
      );
    }

    for (const recipient of RECIPIENTS) {
      await client.query(
        `INSERT INTO recipients (id, user_id, display_name, account_holder_name, country_code,
                                 currency_code, account_summary, provider, provider_recipient_id)
         VALUES ($1, $2, $3, $3, $4, $5, $6, 'mock', $7)`,
        [
          recipient.id,
          ALICE,
          recipient.name,
          recipient.country,
          recipient.currency,
          recipient.summary,
          `mock-recipient-seed-${recipient.id}`,
        ],
      );
    }

    for (const t of TRANSFERS) {
      const quoteId = uuid('b', t.n);
      const transferId = uuid('c', t.n);
      const recipient = RECIPIENTS[t.recipient];
      await client.query(
        `INSERT INTO transfer_quotes (id, user_id, source_currency, destination_currency,
                                      source_amount_minor, fee_amount_minor, destination_amount_minor,
                                      exchange_rate, rate_source, provider, provider_quote_id, expires_at)
         VALUES ($1, $2, 'GBP', $3, $4, $5, $6, $7, 'mock', 'mock', $8, now() + interval '30 minutes')`,
        [
          quoteId,
          ALICE,
          t.target,
          t.source,
          t.fee,
          t.targetMinor,
          t.rate,
          `mock-quote-seed-${t.n}`,
        ],
      );
      await client.query(
        `INSERT INTO transfers (id, reference, user_id, recipient_id, quote_id, idempotency_key,
                                source_currency, destination_currency, source_amount_minor,
                                fee_amount_minor, total_to_pay_minor, destination_amount_minor,
                                exchange_rate, answers, funding_method)
         VALUES ($1, $2, $3, $4, $5, $6, 'GBP', $7, $8, $9, $10, $11, $12, $13::jsonb, $14)`,
        [
          transferId,
          `ALM-SEED${String(t.n).padStart(4, '0')}`,
          ALICE,
          recipient.id,
          quoteId,
          uuid('d', t.n),
          t.target,
          t.source,
          t.fee,
          t.source + t.fee,
          t.targetMinor,
          t.rate,
          JSON.stringify({ purpose: 'family_support' }),
          t.method,
        ],
      );
      await client.query(
        `UPDATE transfers SET provider = 'mock', provider_transfer_id = $2,
                submitted_to_provider_at = now() WHERE id = $1`,
        [transferId, `mock-transfer-seed-${t.n}`],
      );
      // Walk the transfer through its statuses the way the application does,
      // so the state machine and the event history are exercised, not bypassed.
      for (const status of t.path) {
        const fromProvider = status !== 'FAILED';
        await client.query(`SELECT set_config('almapay.status_source', $1, TRUE)`, [
          status === 'AWAITING_FUNDS'
            ? 'provider_response'
            : fromProvider
              ? 'provider_webhook'
              : 'system',
        ]);
        await client.query(
          `UPDATE transfers SET status = $2, provider_status = $3,
                  failure_reason = CASE WHEN $2 = 'FAILED' THEN 'create:VALIDATION_FAILED' END,
                  sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE sent_at END,
                  completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END,
                  failed_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE failed_at END
           WHERE id = $1`,
          [transferId, status, fromProvider ? status.toLowerCase() : null],
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, base: { component: 'db-seed' } });

  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }
  if (env.PAYOUT_PROVIDER !== 'mock') {
    throw new Error('Refusing to seed: seed data is for PAYOUT_PROVIDER=mock only.');
  }

  const pool = createDatabasePool(env.DATABASE_URL, { max: 2 });
  try {
    const { rowCount } = await pool.query(`SELECT 1 FROM users WHERE id = ANY($1::uuid[])`, [
      USERS.map((u) => u.id),
    ]);
    if ((rowCount ?? 0) > 0) {
      logger.info('db.seed.skipped', { reason: 'seed customers already exist' });
      return;
    }
    const password = process.env.SEED_USER_PASSWORD;
    const passwordHash = password ? await new Argon2PasswordHasher().hash(password) : null;
    await seed(pool, passwordHash);
    logger.info('db.seed.done', {
      users: USERS.length,
      recipients: RECIPIENTS.length,
      transfers: TRANSFERS.length,
      loginEnabled: passwordHash !== null,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
