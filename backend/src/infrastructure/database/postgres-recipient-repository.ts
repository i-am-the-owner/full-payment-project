import type {
  CreateRecipientRecord,
  RecipientRepository,
} from '../../application/transfer/ports.ts';
import { isProviderName } from '../../domain/payout/models.ts';
import type { Recipient } from '../../domain/transfer/models.ts';
import type { DatabasePool } from './pool.ts';

interface RecipientRow {
  id: string;
  user_id: string;
  display_name: string;
  account_holder_name: string;
  country_code: string;
  currency_code: string;
  account_summary: string;
  provider: string | null;
  provider_recipient_id: string | null;
  is_active: boolean;
}

function toRecipient(row: RecipientRow): Recipient {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    accountHolderName: row.account_holder_name,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    accountSummary: row.account_summary,
    provider: isProviderName(row.provider) ? row.provider : undefined,
    providerRecipientId: row.provider_recipient_id ?? undefined,
    isActive: row.is_active,
  };
}

/** Stores recipient summaries only. Bank details are never written here. */
export class PostgresRecipientRepository implements RecipientRepository {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async create(record: CreateRecipientRecord): Promise<Recipient> {
    const { rows } = await this.#pool.query<RecipientRow>(
      `INSERT INTO recipients
         (user_id, display_name, account_holder_name, country_code, currency_code,
          account_summary, provider, provider_recipient_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        record.userId,
        record.displayName,
        record.accountHolderName,
        record.countryCode,
        record.currencyCode,
        record.accountSummary,
        record.provider,
        record.providerRecipientId,
      ],
    );
    return toRecipient(rows[0]!);
  }

  async findById(id: string): Promise<Recipient | null> {
    const { rows } = await this.#pool.query<RecipientRow>(
      `SELECT * FROM recipients WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecipient(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<Recipient[]> {
    const { rows } = await this.#pool.query<RecipientRow>(
      `SELECT * FROM recipients WHERE user_id = $1 AND is_active ORDER BY created_at DESC
       LIMIT 200`,
      [userId],
    );
    return rows.map(toRecipient);
  }

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    const { rows } = await this.#pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM recipients WHERE user_id = $1 AND created_at >= $2`,
      [userId, since],
    );
    return Number(rows[0]?.n ?? '0');
  }

  async archive(id: string): Promise<void> {
    await this.#pool.query(
      `UPDATE recipients SET is_active = FALSE, archived_at = now() WHERE id = $1 AND is_active`,
      [id],
    );
  }
}
