import { randomUUID } from 'node:crypto';
import type {
  StoredWebhookEvent,
  WebhookEventRepository,
  WebhookProcessingResult,
} from '../../application/transfer/ports.ts';
import type { CustomerStatus, NormalisedEvent, ProviderName } from '../../domain/payout/models.ts';
import type { TransferStatus } from '../../domain/payout/transfer-status.ts';
import type { DatabasePool } from './pool.ts';

/** The normalised event as stored: JSON-safe, and free of the raw payload. */
interface StoredEventJson {
  type: NormalisedEvent['type'];
  providerTransferId: string | null;
  newStatus: TransferStatus | null;
  providerStatus: string | null;
  eventId: string | null;
  occurredAt: string;
  providerCustomerRef: string | null;
  newCustomerStatus: CustomerStatus | null;
}

function toJson(event: NormalisedEvent): StoredEventJson {
  return {
    type: event.type,
    providerTransferId: event.providerTransferId ?? null,
    newStatus: event.newStatus,
    providerStatus: event.providerStatus ?? null,
    eventId: event.eventId ?? null,
    occurredAt: event.occurredAt.toISOString(),
    providerCustomerRef: event.providerCustomerRef ?? null,
    newCustomerStatus: event.newCustomerStatus ?? null,
  };
}

function fromJson(json: StoredEventJson, raw: unknown): NormalisedEvent {
  return {
    type: json.type,
    providerTransferId: json.providerTransferId ?? undefined,
    newStatus: json.newStatus,
    providerStatus: json.providerStatus ?? undefined,
    eventId: json.eventId ?? undefined,
    occurredAt: new Date(json.occurredAt),
    raw,
    providerCustomerRef: json.providerCustomerRef ?? undefined,
    newCustomerStatus: json.newCustomerStatus,
  };
}

export class PostgresWebhookEventRepository implements WebhookEventRepository {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async recordUnverified(input: {
    provider: ProviderName;
    bodySha256: string;
    bodyBytes: number;
  }): Promise<void> {
    // Each attempt is its own row; nothing from the body is kept but its hash and length.
    const id = `invalid:${randomUUID()}`;
    await this.#pool.query(
      `INSERT INTO webhook_events
         (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload,
          processing_status, processing_error, processed_at)
       VALUES ($1, $2, $2, 'unverified', FALSE, $3::jsonb, 'failed', 'invalid_signature', now())`,
      [
        input.provider,
        id,
        JSON.stringify({ bodySha256: input.bodySha256, bodyBytes: input.bodyBytes }),
      ],
    );
  }

  async recordVerified(input: {
    provider: ProviderName;
    providerEventId: string;
    bodyHash: string;
    event: NormalisedEvent;
    redactedPayload: unknown;
  }): Promise<{ id: string; isNew: boolean; processed: boolean }> {
    // The same event may arrive again with an identical body (a retry) or with
    // a different one (a re-send): either way it is the same event.
    const inserted = await this.#pool.query<{ id: string }>(
      `INSERT INTO webhook_events
         (provider, provider_event_id, dedupe_key, event_type, signature_verified, payload,
          normalised_event)
       VALUES ($1, $2, $3, $4, TRUE, $5::jsonb, $6::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        input.provider,
        input.providerEventId,
        input.bodyHash,
        input.event.type,
        JSON.stringify(input.redactedPayload ?? {}),
        JSON.stringify(toJson(input.event)),
      ],
    );
    if (inserted.rows[0]) {
      return { id: inserted.rows[0].id, isNew: true, processed: false };
    }
    const { rows } = await this.#pool.query<{ id: string; processing_status: string }>(
      `SELECT id, processing_status FROM webhook_events
       WHERE provider = $1 AND (provider_event_id = $2 OR dedupe_key = $3)
       ORDER BY received_at LIMIT 1`,
      [input.provider, input.providerEventId, input.bodyHash],
    );
    const row = rows[0];
    return {
      id: row?.id ?? '',
      isNew: false,
      processed: row ? row.processing_status !== 'pending' : false,
    };
  }

  async findById(id: string): Promise<StoredWebhookEvent | null> {
    const { rows } = await this.#pool.query<{
      id: string;
      provider: ProviderName;
      provider_event_id: string;
      payload: unknown;
      normalised_event: StoredEventJson | null;
      processing_status: string;
    }>(
      `SELECT id, provider, provider_event_id, payload, normalised_event, processing_status
       FROM webhook_events WHERE id = $1 AND signature_verified`,
      [id],
    );
    const row = rows[0];
    if (!row?.normalised_event) {
      return null;
    }
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.provider_event_id,
      event: fromJson(row.normalised_event, row.payload),
      processed: row.processing_status !== 'pending',
    };
  }

  async relateToTransfer(id: string, transferId: string): Promise<void> {
    await this.#pool.query(`UPDATE webhook_events SET related_transfer_id = $2 WHERE id = $1`, [
      id,
      transferId,
    ]);
  }

  async markProcessed(id: string, result: WebhookProcessingResult, note?: string): Promise<void> {
    await this.#pool.query(
      `UPDATE webhook_events
       SET processing_status = $2, processing_error = $3, processed_at = now()
       WHERE id = $1 AND processed_at IS NULL`,
      [id, result, note ?? null],
    );
  }
}
