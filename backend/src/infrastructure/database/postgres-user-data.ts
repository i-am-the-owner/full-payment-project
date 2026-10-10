import { randomUUID } from 'node:crypto';
import type {
  ErasureReport,
  UserDataExport,
  UserDataRepository,
} from '../../application/privacy/user-data.ts';
import type { DatabasePool } from './pool.ts';

const FINISHED = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

const NOT_INCLUDED = [
  'The password hash, the two-step sign-in secret, refresh tokens and session tokens: these are credentials, not your data.',
  'Bank details: SomPay never holds full bank details. Your recipients are stored as a masked summary; the full details are held by the payment provider.',
  'Data held by the payment provider (including the identity documents you gave it): ask the provider directly.',
];

/** Subject access and erasure over the application's own database. */
export class PostgresUserData implements UserDataRepository {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async findUser(
    identifier: string,
  ): Promise<{ id: string; email: string; status: string } | null> {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const { rows } = await this.#pool.query<{ id: string; email: string; status: string }>(
      isId
        ? `SELECT id, email::text, status FROM users WHERE id = $1`
        : `SELECT id, email::text, status FROM users WHERE email = $1`,
      [identifier],
    );
    return rows[0] ?? null;
  }

  async countUnfinishedTransfers(userId: string): Promise<number> {
    const { rows } = await this.#pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM transfers WHERE user_id = $1 AND NOT (status = ANY($2))`,
      [userId, FINISHED],
    );
    return Number(rows[0]?.n ?? '0');
  }

  async export(userId: string): Promise<Omit<UserDataExport, 'exportedAt'>> {
    const q = async (sql: string): Promise<Record<string, unknown>[]> =>
      (await this.#pool.query<Record<string, unknown>>(sql, [userId])).rows;

    const [user] = await q(
      `SELECT id, email::text AS email, status, email_verified_at, created_at FROM users WHERE id = $1`,
    );
    const [profile] = await q(
      `SELECT first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              country_of_residence, phone FROM users WHERE id = $1`,
    );
    const [security] = await q(
      `SELECT password_updated_at, last_login_at, last_login_ip::text AS last_login_ip,
              (totp_enabled_at IS NOT NULL) AS two_step_sign_in_on
       FROM user_auth WHERE user_id = $1`,
    );
    return {
      user: user ?? {},
      profile: profile ?? {},
      security: security ?? {},
      sessions: await q(
        `SELECT created_at, last_used_at, expires_at, status, user_agent, ip_address::text AS ip_address
         FROM auth_sessions WHERE user_id = $1 ORDER BY created_at`,
      ),
      providerLinks: await q(
        `SELECT provider, provider_customer_id, provider_profile_id, kyc_status, linked_at
         FROM provider_links WHERE user_id = $1`,
      ),
      recipients: await q(
        `SELECT id, display_name, account_holder_name, country_code, currency_code, account_summary,
                is_active, created_at FROM recipients WHERE user_id = $1 ORDER BY created_at`,
      ),
      quotes: await q(
        `SELECT id, source_currency, destination_currency, source_amount_minor, fee_amount_minor,
                destination_amount_minor, exchange_rate, expires_at, created_at
         FROM transfer_quotes WHERE user_id = $1 ORDER BY created_at`,
      ),
      transfers: await q(
        `SELECT t.id, t.reference, t.recipient_reference, t.status, t.source_currency,
                t.destination_currency, t.source_amount_minor, t.fee_amount_minor,
                t.total_to_pay_minor, t.destination_amount_minor, t.exchange_rate, t.funding_method,
                t.provider, t.provider_transfer_id, t.recipient_id, t.created_at, t.completed_at,
                (SELECT COALESCE(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.occurred_at,
                          'source', e.source) ORDER BY e.occurred_at), '[]'::jsonb)
                 FROM transfer_events e WHERE e.transfer_id = t.id AND e.applied) AS history
         FROM transfers t WHERE t.user_id = $1 ORDER BY t.created_at`,
      ),
      notifications: await q(
        `SELECT transfer_id, kind, channel, sent_at FROM transfer_notifications WHERE user_id = $1`,
      ),
      auditEvents: await q(
        `SELECT created_at, action, entity_type, entity_id, ip_address::text AS ip_address
         FROM audit_events WHERE (entity_type = 'user' AND entity_id = $1::text) OR actor_id = $1::text
         ORDER BY created_at`,
      ),
      notIncluded: NOT_INCLUDED,
    };
  }

  async erase(
    userId: string,
    options: { scrubAuditIpAddresses: boolean },
  ): Promise<Omit<ErasureReport, 'userId'>> {
    const client = await this.#pool.connect();
    const deleted: Record<string, number> = {};
    const retained: Record<string, number> = {};
    const run = async (
      label: string,
      sql: string,
      params: unknown[] = [userId],
    ): Promise<number> => {
      const result = await client.query(sql, params);
      return result.rowCount ?? 0;
    };
    try {
      await client.query('BEGIN');

      // Credentials, sessions and anything that could sign in as this person.
      deleted.sessions = await run('sessions', `DELETE FROM auth_sessions WHERE user_id = $1`);
      deleted.authTokens = await run('authTokens', `DELETE FROM auth_tokens WHERE user_id = $1`);
      deleted.onboardingStates = await run(
        'onboardingStates',
        `DELETE FROM onboarding_states WHERE user_id = $1`,
      );
      await run(
        'auth',
        `UPDATE user_auth SET password_hash = NULL, totp_secret_encrypted = NULL, totp_key_version = NULL,
                totp_enabled_at = NULL, totp_last_counter = NULL, last_login_ip = NULL,
                failed_login_attempts = 0, locked_until = NULL
         WHERE user_id = $1`,
      );

      // Provider links keep their ids (they tie retained transfers to the provider)
      // but lose the stored refresh token and can no longer be used.
      await run(
        'links',
        `UPDATE provider_links SET encrypted_refresh_token = NULL, token_key_version = NULL,
                kyc_status = CASE WHEN kyc_status = 'VERIFIED' THEN 'NEEDS_RELINK' ELSE kyc_status END
         WHERE user_id = $1`,
      );

      // Recipients never used in a transfer are removed; the rest are part of a retained record.
      deleted.recipients = await run(
        'recipients',
        `DELETE FROM recipients r WHERE r.user_id = $1
           AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.recipient_id = r.id)`,
      );
      await run(
        'recipientsArchived',
        `UPDATE recipients SET is_active = FALSE, archived_at = COALESCE(archived_at, now())
         WHERE user_id = $1 AND is_active`,
      );
      // Quotes that no transfer used.
      deleted.unusedQuotes = await run(
        'quotes',
        `DELETE FROM transfer_quotes q WHERE q.user_id = $1
           AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.quote_id = q.id)`,
      );

      // The account itself: anonymised, not deleted, so retained transfers keep their owner.
      await run(
        'user',
        `UPDATE users SET email = $2, status = 'closed', first_name = NULL, last_name = NULL,
                date_of_birth = NULL, phone = NULL, country_of_residence = NULL
         WHERE id = $1`,
        [userId, `erased-${randomUUID()}@deleted.invalid`],
      );

      if (options.scrubAuditIpAddresses) {
        // The audit log is append-only, so this needs the table's owner. Only the
        // network address is removed; the record that something happened stays.
        await client.query(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
        deleted.auditIpAddresses = await run(
          'auditIps',
          `UPDATE audit_events SET ip_address = NULL
           WHERE ip_address IS NOT NULL AND ((entity_type = 'user' AND entity_id = $1::text) OR actor_id = $1::text)`,
        );
        await client.query(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);
      }

      const count = async (sql: string): Promise<number> =>
        Number((await client.query<{ n: string }>(sql, [userId])).rows[0]?.n ?? '0');
      retained.transfers = await count(
        `SELECT count(*)::text AS n FROM transfers WHERE user_id = $1`,
      );
      retained.recipientsUsedInTransfers = await count(
        `SELECT count(*)::text AS n FROM recipients WHERE user_id = $1`,
      );
      retained.auditEvents = await count(
        `SELECT count(*)::text AS n FROM audit_events WHERE (entity_type = 'user' AND entity_id = $1::text) OR actor_id = $1::text`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      deleted,
      retained,
      notes: [
        'Transfer records and the recipient summaries they refer to are kept: financial records must be retained for five years (Money Laundering Regulations 2017).',
        'The audit log is append-only and is kept; it now refers to an anonymised account.' +
          (options.scrubAuditIpAddresses
            ? ' IP addresses were removed from it.'
            : ' Re-run with --scrub-audit-ips (as the database owner) to remove IP addresses from it.'),
        'SomPay cannot erase data held by the payment provider (including identity documents). Send the request to the provider too.',
      ],
    };
  }
}
