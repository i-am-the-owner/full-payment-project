import type {
  CreateTransferRecord,
  LocalStatusChange,
  Page,
  ProviderStatusEvidence,
  TransferRepository,
} from '../../application/transfer/ports.ts';
import {
  InvalidTransferTransitionError,
  StaleProviderEventError,
} from '../../application/transfer/ports.ts';
import {
  isProviderName,
  type FundingMethod,
  type ProviderName,
} from '../../domain/payout/models.ts';
import type { TransferStatus } from '../../domain/payout/transfer-status.ts';
import type { Transfer, TransferEvent } from '../../domain/transfer/models.ts';
import type { DatabasePool } from './pool.ts';

interface TransferRow {
  id: string;
  reference: string;
  user_id: string;
  recipient_id: string;
  quote_id: string;
  status: TransferStatus;
  idempotency_key: string;
  source_currency: string;
  destination_currency: string;
  source_amount_minor: string;
  fee_amount_minor: string;
  total_to_pay_minor: string;
  destination_amount_minor: string;
  exchange_rate: string;
  answers: Record<string, string>;
  recipient_reference: string | null;
  provider: string | null;
  provider_transfer_id: string | null;
  provider_status: string | null;
  funding_method: FundingMethod | null;
  failure_reason: string | null;
  provider_status_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// SQLSTATE raised by the transfer state-machine / freeze triggers.
const RESTRICT_VIOLATION = '23001';

/** Sets the lifecycle timestamp that belongs to the new status. */
const STATUS_UPDATE = `
  status = $2,
  provider_status = COALESCE($3, provider_status),
  failure_reason = COALESCE($4, failure_reason),
  sent_at      = CASE WHEN $2 = 'SENT'      THEN COALESCE(sent_at, now())      ELSE sent_at END,
  completed_at = CASE WHEN $2 = 'COMPLETED' THEN COALESCE(completed_at, now()) ELSE completed_at END,
  failed_at    = CASE WHEN $2 = 'FAILED'    THEN now() ELSE failed_at END,
  cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE cancelled_at END,
  refunded_at  = CASE WHEN $2 = 'REFUNDED'  THEN now() ELSE refunded_at END
`;

/** The `transfer_events.source` value for each kind of provider evidence. */
const EVENT_SOURCE: Record<ProviderStatusEvidence['source'], string> = {
  provider_webhook: 'WEBHOOK',
  provider_lookup: 'POLL',
  provider_response: 'PROVIDER_RESPONSE',
};

function toTransfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.user_id,
    recipientId: row.recipient_id,
    quoteId: row.quote_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    source: { currency: row.source_currency, amountMinor: BigInt(row.source_amount_minor) },
    fee: { currency: row.source_currency, amountMinor: BigInt(row.fee_amount_minor) },
    totalToPay: { currency: row.source_currency, amountMinor: BigInt(row.total_to_pay_minor) },
    target: {
      currency: row.destination_currency,
      amountMinor: BigInt(row.destination_amount_minor),
    },
    exchangeRate: row.exchange_rate,
    answers: row.answers,
    recipientReference: row.recipient_reference ?? undefined,
    provider: isProviderName(row.provider) ? row.provider : undefined,
    providerTransferId: row.provider_transfer_id ?? undefined,
    providerStatus: row.provider_status ?? undefined,
    fundingMethod: row.funding_method ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    providerStatusAt: row.provider_status_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isPgError(error: unknown): error is { code?: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export class PostgresTransferRepository implements TransferRepository {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<Transfer | null> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key],
    );
    return rows[0] ? toTransfer(rows[0]) : null;
  }

  async findById(id: string): Promise<Transfer | null> {
    const { rows } = await this.#pool.query<TransferRow>(`SELECT * FROM transfers WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? toTransfer(rows[0]) : null;
  }

  async findByQuoteId(quoteId: string): Promise<Transfer | null> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE quote_id = $1`,
      [quoteId],
    );
    return rows[0] ? toTransfer(rows[0]) : null;
  }

  async findByProviderTransferId(
    provider: ProviderName,
    providerTransferId: string,
  ): Promise<Transfer | null> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE provider = $1 AND provider_transfer_id = $2`,
      [provider, providerTransferId],
    );
    return rows[0] ? toTransfer(rows[0]) : null;
  }

  async listForUser(userId: string, page: Page): Promise<Transfer[]> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE user_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return rows.map(toTransfer);
  }

  async listEvents(transferId: string): Promise<TransferEvent[]> {
    const { rows } = await this.#pool.query<{
      status: TransferStatus;
      source: string;
      occurred_at: Date;
      applied: boolean;
      reason: string | null;
    }>(
      `SELECT status, source, occurred_at, applied, reason FROM transfer_events
       WHERE transfer_id = $1 ORDER BY occurred_at, id`,
      [transferId],
    );
    return rows.map((row) => ({
      status: row.status,
      source: row.source,
      occurredAt: row.occurred_at,
      applied: row.applied,
      reason: row.applied ? undefined : (row.reason ?? undefined),
    }));
  }

  async totalPaidSince(userId: string, currency: string, since: Date): Promise<bigint> {
    const { rows } = await this.#pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(total_to_pay_minor), 0)::text AS total FROM transfers
       WHERE user_id = $1 AND source_currency = $2 AND created_at >= $3
         AND status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`,
      [userId, currency, since],
    );
    return BigInt(rows[0]?.total ?? '0');
  }

  async create(record: CreateTransferRecord): Promise<Transfer> {
    const { rows } = await this.#pool.query<TransferRow>(
      `INSERT INTO transfers
         (reference, user_id, recipient_id, quote_id, idempotency_key,
          source_currency, destination_currency, source_amount_minor, fee_amount_minor,
          total_to_pay_minor, destination_amount_minor, exchange_rate, answers,
          recipient_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
       RETURNING *`,
      [
        record.reference,
        record.userId,
        record.recipientId,
        record.quoteId,
        record.idempotencyKey,
        record.source.currency,
        record.target.currency,
        record.source.amountMinor.toString(),
        record.fee.amountMinor.toString(),
        (record.source.amountMinor + record.fee.amountMinor).toString(),
        record.target.amountMinor.toString(),
        record.exchangeRate,
        JSON.stringify(record.answers),
        record.recipientReference ?? null,
      ],
    );
    return toTransfer(rows[0]!);
  }

  async attachProviderTransfer(
    transferId: string,
    provider: ProviderName,
    providerTransferId: string,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE transfers
       SET provider = $2, provider_transfer_id = $3,
           submitted_to_provider_at = COALESCE(submitted_to_provider_at, now())
       WHERE id = $1`,
      [transferId, provider, providerTransferId],
    );
  }

  async recordFundingMethod(transferId: string, method: FundingMethod): Promise<void> {
    await this.#pool.query(`UPDATE transfers SET funding_method = $2 WHERE id = $1`, [
      transferId,
      method,
    ]);
  }

  /**
   * `actor` is recorded on the transfer event (USER or SYSTEM). It is not
   * provider evidence: the database still refuses any transition that needs it.
   */
  async applyLocalStatusChange(transferId: string, change: LocalStatusChange): Promise<Transfer> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('almapay.status_source', $1, TRUE)`, [change.actor]);
      const { rows } = await client.query<TransferRow>(
        `UPDATE transfers SET ${STATUS_UPDATE} WHERE id = $1 RETURNING *`,
        [transferId, change.status, null, change.failureReason],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`Transfer ${transferId} not found`);
      }
      await client.query('COMMIT');
      return toTransfer(row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPgError(error) && error.code === RESTRICT_VIOLATION) {
        throw new InvalidTransferTransitionError('current', change.status);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The only code path that declares provider evidence to the database. The
   * declaration is transaction-local, so it cannot leak to another statement
   * on a pooled connection.
   */
  async applyProviderStatus(
    transferId: string,
    evidence: ProviderStatusEvidence,
  ): Promise<Transfer> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('almapay.status_source', $1, TRUE)`, [evidence.source]);
      await client.query(`SELECT set_config('almapay.event_payload', $1, TRUE)`, [
        evidence.eventPayload === undefined ? '' : JSON.stringify(evidence.eventPayload),
      ]);
      // Lock the row: two events for one transfer are applied one after the other.
      const current = await client.query<{ provider_status_at: Date | null }>(
        `SELECT provider_status_at FROM transfers
         WHERE id = $1 AND provider = $2 AND provider_transfer_id = $3 FOR UPDATE`,
        [transferId, evidence.provider, evidence.providerTransferId],
      );
      if (!current.rows[0]) {
        throw new Error(
          `Transfer ${transferId} is not provider transfer ${evidence.providerTransferId}`,
        );
      }
      // Only the provider's own webhook timestamps are compared with each other.
      const newerAlreadyApplied = current.rows[0].provider_status_at;
      if (
        evidence.source === 'provider_webhook' &&
        newerAlreadyApplied &&
        newerAlreadyApplied.getTime() > evidence.occurredAt.getTime()
      ) {
        throw new StaleProviderEventError();
      }
      const { rows } = await client.query<TransferRow>(
        `UPDATE transfers SET ${STATUS_UPDATE},
           provider_status_at = CASE WHEN $7 = 'provider_webhook'
             THEN GREATEST(COALESCE(provider_status_at, $8), $8) ELSE provider_status_at END
         WHERE id = $1 AND provider = $5 AND provider_transfer_id = $6
         RETURNING *`,
        [
          transferId,
          evidence.status,
          evidence.providerStatus,
          evidence.status === 'FAILED' ? `provider:${evidence.providerStatus}` : null,
          evidence.provider,
          evidence.providerTransferId,
          evidence.source,
          evidence.occurredAt,
        ],
      );
      await client.query('COMMIT');
      return toTransfer(rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPgError(error) && error.code === RESTRICT_VIOLATION) {
        throw new InvalidTransferTransitionError('current', evidence.status);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordIgnoredEvent(
    transferId: string,
    evidence: ProviderStatusEvidence,
    reason: string,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO transfer_events
         (transfer_id, from_status, status, reason, source, applied, raw_payload)
       SELECT id, status, $2, $3, $4, FALSE,
              jsonb_build_object('provider', $5::text, 'providerStatus', $6::text)
                || CASE WHEN $7::jsonb IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('event', $7::jsonb) END
       FROM transfers WHERE id = $1`,
      [
        transferId,
        evidence.status,
        reason,
        EVENT_SOURCE[evidence.source],
        evidence.provider,
        evidence.providerStatus,
        evidence.eventPayload === undefined ? null : JSON.stringify(evidence.eventPayload),
      ],
    );
  }

  async listStuck(query: {
    provider: ProviderName;
    unchangedSince: Date;
    createdAfter: Date;
    notPolledSince: Date;
    limit: number;
  }): Promise<Transfer[]> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT t.* FROM transfers t
       WHERE t.provider = $1 AND t.provider_transfer_id IS NOT NULL
         AND t.status NOT IN ('COMPLETED', 'CANCELLED', 'REFUNDED')
         AND t.created_at > $3
         AND COALESCE(
               (SELECT max(e.occurred_at) FROM transfer_events e
                WHERE e.transfer_id = t.id AND e.applied),
               t.created_at) < $2
         AND (t.last_polled_at IS NULL OR t.last_polled_at < $4)
       ORDER BY t.last_polled_at NULLS FIRST, t.created_at
       LIMIT $5`,
      [query.provider, query.unchangedSince, query.createdAfter, query.notPolledSince, query.limit],
    );
    return rows.map(toTransfer);
  }

  async listUnsubmitted(query: {
    provider: ProviderName;
    createdBefore: Date;
    createdAfter: Date;
    notPolledSince: Date;
    limit: number;
  }): Promise<Transfer[]> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT t.* FROM transfers t JOIN transfer_quotes q ON q.id = t.quote_id
       WHERE q.provider = $1 AND t.provider_transfer_id IS NULL AND t.status = 'DRAFT'
         AND t.created_at < $2 AND t.created_at > $3
         AND (t.last_polled_at IS NULL OR t.last_polled_at < $4)
       ORDER BY t.created_at LIMIT $5`,
      [query.provider, query.createdBefore, query.createdAfter, query.notPolledSince, query.limit],
    );
    return rows.map(toTransfer);
  }

  async countFailedSince(userId: string, since: Date): Promise<number> {
    const { rows } = await this.#pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM transfers
       WHERE user_id = $1 AND status = 'FAILED' AND COALESCE(failed_at, updated_at) >= $2`,
      [userId, since],
    );
    return Number(rows[0]?.n ?? '0');
  }

  async markPolled(transferId: string, at: Date): Promise<void> {
    await this.#pool.query(`UPDATE transfers SET last_polled_at = $2 WHERE id = $1`, [
      transferId,
      at,
    ]);
  }
}
