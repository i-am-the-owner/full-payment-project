import { randomUUID } from 'node:crypto';
import type { Container } from '../../container.ts';
import { Argon2PasswordHasher } from '../auth/argon2-password-hasher.ts';
import { totpCode, totpCounter } from '../auth/totp.ts';

export const DEMO_PASSWORD = 'demo-password-123';
export const DEMO_CUSTOMER_EMAIL = 'demo@almapay.test';
export const DEMO_ADMIN_EMAIL = 'admin@almapay.test';

export interface SeedReport {
  readonly alreadySeeded: boolean;
  /** Present only the first time: the authenticator secret for the demo admin. */
  readonly adminTotpSecret?: string;
}

/**
 * Demo data for a local stack on the MOCK provider: a verified customer, an admin
 * (with two-step sign-in), a customer waiting on an identity review, and transfers in
 * every state so the admin dashboard has something to show. Open transfers carry no
 * provider reference, so the worker's stuck-transfer poll leaves them alone (the mock
 * provider keeps its own transfers in memory and would not know them). Refused unless
 * APP_ENV is development; the passwords and the secret are public on purpose.
 */
export async function seedDemoData(container: Container): Promise<SeedReport> {
  if (container.config.isProduction) {
    throw new Error('Demo data is for local development only.');
  }
  const { pool } = container;
  const exists = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [DEMO_CUSTOMER_EMAIL]);
  if (exists.rowCount) {
    return { alreadySeeded: true };
  }
  const hash = await new Argon2PasswordHasher().hash(DEMO_PASSWORD);

  const createUser = async (
    email: string,
    first: string,
    last: string,
    kyc: 'VERIFIED' | 'REJECTED_PENDING_REVIEW' | null,
  ): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, status, email_verified_at, first_name, last_name,
                          date_of_birth, country_of_residence, phone)
       VALUES ($1, 'active', now(), $2, $3, '1990-04-12', 'GB', '+447700900123') RETURNING id`,
      [email, first, last],
    );
    const id = rows[0]!.id;
    await pool.query(
      `INSERT INTO user_auth (user_id, password_hash, password_algorithm) VALUES ($1, $2, 'argon2id')`,
      [id, hash],
    );
    if (kyc) {
      await pool.query(
        `INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status)
         VALUES ($1, 'mock', $2, $3)`,
        [id, `mock-seed-${id}`, kyc],
      );
    }
    return id;
  };

  const customerId = await createUser(DEMO_CUSTOMER_EMAIL, 'Demo', 'Customer', 'VERIFIED');
  const adminId = await createUser(DEMO_ADMIN_EMAIL, 'Demo', 'Admin', null);
  await createUser('review@almapay.test', 'Rita', 'Review', 'REJECTED_PENDING_REVIEW');
  await pool.query(
    `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'admin', 'seed')`,
    [adminId],
  );

  // Two-step sign-in for the admin, through the real service.
  let adminTotpSecret: string | undefined;
  if (container.twoFactor) {
    try {
      const { secret } = await container.twoFactor.setup(adminId);
      await container.twoFactor.enable(adminId, totpCode(secret, totpCounter(new Date()) - 1));
      adminTotpSecret = secret;
    } catch {
      // No ENCRYPTION_KEY: the admin can still be used for the API in tests, but not to sign in.
    }
  }

  // The currency table is a copy of the provider's list; transfers refer to it.
  await container.currencyRegistry.upsertMany(await container.payoutProvider.listCurrencies());

  // Transfers across the last 10 days, in several currencies and states.
  const { rows: rec } = await pool.query<{ id: string }>(
    `INSERT INTO recipients (user_id, provider, provider_recipient_id, currency_code, country_code,
                             account_holder_name, account_summary, display_name)
     VALUES ($1, 'mock', $2, 'EUR', 'DE', 'Anna Schmidt', 'IBAN ••••3000', 'Anna') RETURNING id`,
    [customerId, randomUUID()],
  );
  const recipientId = rec[0]!.id;
  const plan: [number, string, string, number, number, number][] = [
    // [days ago, status, target currency, amount (pence), hours since last change, rate*1000]
    [9, 'COMPLETED', 'EUR', 50_000, 200, 1170],
    [8, 'COMPLETED', 'USD', 120_000, 190, 1270],
    [7, 'COMPLETED', 'INR', 80_000, 170, 105_000],
    [6, 'COMPLETED', 'EUR', 250_000, 140, 1170],
    [5, 'FAILED', 'EUR', 30_000, 120, 1170],
    [4, 'REFUNDED', 'USD', 45_000, 90, 1270],
    [3, 'COMPLETED', 'USD', 300_000, 70, 1270],
    [2, 'PROCESSING', 'EUR', 60_000, 30, 1170], // stuck for 24h+
    [1, 'SENT', 'EUR', 90_000, 5, 1170],
    [0, 'AWAITING_FUNDS', 'USD', 20_000, 1, 1270],
  ];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Status triggers demand provider evidence; demo rows are written directly.
    await client.query(`ALTER TABLE transfers DISABLE TRIGGER USER`);
    for (const [daysAgo, status, target, amount, hoursSince, rate] of plan) {
      const q = await client.query<{ id: string }>(
        `INSERT INTO transfer_quotes (user_id, provider, provider_quote_id, source_currency,
            destination_currency, source_amount_minor, fee_amount_minor, destination_amount_minor,
            exchange_rate, expires_at)
         VALUES ($1, 'mock', $2, 'GBP', $3, $4::bigint, 100, ($4::bigint * $5::bigint) / 1000,
                 $5::numeric / 1000, now() + interval '1 day') RETURNING id`,
        [customerId, randomUUID(), target, amount, rate],
      );
      const created = new Date(Date.now() - daysAgo * 86_400_000);
      const updated = new Date(Date.now() - hoursSince * 3_600_000);
      const t = await client.query<{ id: string }>(
        `INSERT INTO transfers (reference, user_id, recipient_id, quote_id, status, idempotency_key,
            source_currency, destination_currency, source_amount_minor, fee_amount_minor,
            total_to_pay_minor, destination_amount_minor, exchange_rate, provider, provider_transfer_id,
            created_at, updated_at, completed_at, failed_at, refunded_at, sent_at, failure_reason)
         VALUES ($1, $2, $3, $4, $5, $6, 'GBP', $7, $8::bigint, 100, $8::bigint + 100,
                 ($8::bigint * $9::bigint) / 1000, $9::numeric / 1000, CASE WHEN $5 IN ('PROCESSING', 'SENT', 'AWAITING_FUNDS') THEN NULL ELSE 'mock' END,
                 CASE WHEN $5 IN ('PROCESSING', 'SENT', 'AWAITING_FUNDS') THEN NULL ELSE $10 END, $11, $12,
                 CASE WHEN $5 = 'COMPLETED' THEN $12::timestamptz END,
                 CASE WHEN $5 = 'FAILED' THEN $12::timestamptz END,
                 CASE WHEN $5 = 'REFUNDED' THEN $12::timestamptz END,
                 CASE WHEN $5 IN ('SENT', 'COMPLETED') THEN $12::timestamptz END,
                 CASE WHEN $5 = 'FAILED' THEN 'bounced_back' END)
         RETURNING id`,
        [
          `ALM-SEED-${randomUUID().slice(0, 6).toUpperCase()}`,
          customerId,
          recipientId,
          q.rows[0]!.id,
          status,
          randomUUID(),
          target,
          amount,
          rate,
          `mock-seed-${randomUUID()}`,
          created,
          updated,
        ],
      );
      const steps =
        status === 'AWAITING_FUNDS'
          ? ['DRAFT', 'AWAITING_FUNDS']
          : ['DRAFT', 'AWAITING_FUNDS', 'PROCESSING', ...(status === 'PROCESSING' ? [] : [status])];
      let previous: string | null = null;
      for (const step of steps) {
        await client.query(
          `INSERT INTO transfer_events (transfer_id, from_status, status, source, occurred_at)
           VALUES ($1, $2, $3, 'SYSTEM', $4)`,
          [t.rows[0]!.id, previous, step, created],
        );
        previous = step;
      }
    }
    await client.query(`ALTER TABLE transfers ENABLE TRIGGER USER`);
    await client.query(
      `INSERT INTO webhook_events (provider, provider_event_id, dedupe_key, event_type,
          signature_verified, payload, processing_status, processing_error, processed_at)
       VALUES ('mock', 'seed-bad-signature', 'seed-bad-signature', 'unverified', false,
               '{}', 'failed', 'invalid_signature', now())`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { alreadySeeded: false, ...(adminTotpSecret ? { adminTotpSecret } : {}) };
}
