import type { CreateQuoteRecord, QuoteRepository } from '../../application/transfer/ports.ts';
import { isProviderName } from '../../domain/payout/models.ts';
import type { TransferQuote } from '../../domain/transfer/models.ts';
import type { DatabasePool } from './pool.ts';

interface QuoteRow {
  id: string;
  user_id: string;
  source_currency: string;
  destination_currency: string;
  source_amount_minor: string;
  fee_amount_minor: string;
  total_to_pay_minor: string;
  destination_amount_minor: string;
  exchange_rate: string;
  provider: string | null;
  provider_quote_id: string | null;
  estimated_delivery: Date | null;
  expires_at: Date;
  created_at: Date;
}

function toQuote(row: QuoteRow): TransferQuote {
  return {
    id: row.id,
    userId: row.user_id,
    source: { currency: row.source_currency, amountMinor: BigInt(row.source_amount_minor) },
    fee: { currency: row.source_currency, amountMinor: BigInt(row.fee_amount_minor) },
    totalToPay: { currency: row.source_currency, amountMinor: BigInt(row.total_to_pay_minor) },
    target: {
      currency: row.destination_currency,
      amountMinor: BigInt(row.destination_amount_minor),
    },
    exchangeRate: row.exchange_rate,
    provider: isProviderName(row.provider) ? row.provider : undefined,
    providerQuoteId: row.provider_quote_id ?? undefined,
    estimatedDelivery: row.estimated_delivery ?? undefined,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export class PostgresQuoteRepository implements QuoteRepository {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async create(record: CreateQuoteRecord): Promise<TransferQuote> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<QuoteRow>(
        `INSERT INTO transfer_quotes
           (user_id, source_currency, destination_currency,
            source_amount_minor, fee_amount_minor, destination_amount_minor,
            exchange_rate, rate_source, provider, provider_quote_id,
            estimated_delivery, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)
         RETURNING *`,
        [
          record.userId,
          record.source.currency,
          record.target.currency,
          record.source.amountMinor.toString(),
          record.fee.amountMinor.toString(),
          record.target.amountMinor.toString(),
          record.exchangeRate,
          record.provider,
          record.providerQuoteId,
          record.estimatedDelivery ?? null,
          record.expiresAt,
        ],
      );
      const quote = rows[0]!;
      await client.query(
        `INSERT INTO quote_fees (quote_id, description, amount_minor, currency_code)
         VALUES ($1, $2, $3, $4)`,
        [quote.id, 'Provider fee', record.fee.amountMinor.toString(), record.fee.currency],
      );
      await client.query('COMMIT');
      return toQuote(quote);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<TransferQuote | null> {
    const { rows } = await this.#pool.query<QuoteRow>(
      `SELECT * FROM transfer_quotes WHERE id = $1`,
      [id],
    );
    return rows[0] ? toQuote(rows[0]) : null;
  }
}
