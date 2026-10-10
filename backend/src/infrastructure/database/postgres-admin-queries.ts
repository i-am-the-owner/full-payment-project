import type {
  AdminQueries,
  AdminTransferDetail,
  AdminTransferRow,
  AdminUserDetail,
  AdminUserRow,
  AdminWebhookRow,
  IdentityReviewRow,
  VolumeRow,
} from '../../application/admin/admin-queries.ts';
import type { DatabasePool } from './pool.ts';

const FINAL = ['COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'];
// Money was taken from the customer (or is on its way from them to the provider).
const MONEY_TAKEN = ['PROCESSING', 'SENT', 'COMPLETED'];

const TRANSFER_COLUMNS = `t.id, t.reference, t.user_id, t.status, t.provider, t.provider_status,
  t.source_currency, t.source_amount_minor::text AS source_amount_minor,
  t.destination_currency, t.destination_amount_minor::text AS destination_amount_minor,
  t.created_at, t.updated_at`;

interface TransferDbRow {
  id: string;
  reference: string;
  user_id: string;
  status: string;
  provider: string | null;
  provider_status: string | null;
  source_currency: string;
  source_amount_minor: string;
  destination_currency: string;
  destination_amount_minor: string;
  created_at: Date;
  updated_at: Date;
}

const toTransferRow = (r: TransferDbRow): AdminTransferRow => ({
  id: r.id,
  reference: r.reference,
  userId: r.user_id,
  status: r.status,
  provider: r.provider,
  providerStatus: r.provider_status,
  sourceCurrency: r.source_currency.trim(),
  sourceAmountMinor: r.source_amount_minor,
  destinationCurrency: r.destination_currency.trim(),
  destinationAmountMinor: r.destination_amount_minor,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

interface WebhookDbRow {
  id: string;
  provider: string;
  event_type: string;
  signature_verified: boolean;
  processing_status: string;
  processing_error: string | null;
  related_transfer_id: string | null;
  received_at: Date;
  processed_at: Date | null;
}

const WEBHOOK_COLUMNS = `id, provider, event_type, signature_verified, processing_status,
  processing_error, related_transfer_id, received_at, processed_at`;

const toWebhookRow = (r: WebhookDbRow): AdminWebhookRow => ({
  id: r.id,
  provider: r.provider,
  eventType: r.event_type,
  signatureVerified: r.signature_verified,
  processingStatus: r.processing_status,
  processingError: r.processing_error,
  relatedTransferId: r.related_transfer_id,
  receivedAt: r.received_at,
  processedAt: r.processed_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only queries for the admin console. Every statement here is a SELECT.
 * Webhook bodies, bank details and raw provider payloads are never selected.
 */
export class PostgresAdminQueries implements AdminQueries {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async searchUsers(filter: {
    q?: string | undefined;
    limit: number;
    offset: number;
  }): Promise<AdminUserRow[]> {
    const q = filter.q?.trim();
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q) {
      if (UUID.test(q)) {
        params.push(q);
        where = `u.id = $${params.length}`;
      } else {
        // Escape LIKE wildcards so the search term is taken literally.
        params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where = `(u.email ILIKE $${params.length}
                  OR (coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, ''))
                       ILIKE $${params.length})`;
      }
    }
    params.push(filter.limit, filter.offset);
    const { rows } = await this.#pool.query<{
      id: string;
      email: string;
      name: string;
      status: string;
      created_at: Date;
      kyc_status: string | null;
    }>(
      `SELECT u.id, u.email::text AS email,
              nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') AS name,
              u.status, u.created_at,
              (SELECT kyc_status FROM provider_links p WHERE p.user_id = u.id
                 ORDER BY p.updated_at DESC LIMIT 1) AS kyc_status
       FROM users u WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map((r): AdminUserRow => ({
      id: r.id,
      email: r.email,
      name: r.name,
      status: r.status,
      createdAt: r.created_at,
      kycStatus: r.kyc_status,
    }));
  }

  async getUser(id: string): Promise<AdminUserDetail | null> {
    if (!UUID.test(id)) {
      return null;
    }
    const { rows } = await this.#pool.query<{
      id: string;
      email: string;
      name: string | null;
      status: string;
      created_at: Date;
      email_verified: boolean;
      country: string | null;
      last_login_at: Date | null;
      two_factor: boolean;
      roles: string[];
      transfer_count: string;
    }>(
      `SELECT u.id, u.email::text AS email,
              nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') AS name,
              u.status, u.created_at, (u.email_verified_at IS NOT NULL) AS email_verified,
              u.country_of_residence AS country, a.last_login_at,
              coalesce(a.totp_enabled_at IS NOT NULL, false) AS two_factor,
              coalesce((SELECT array_agg(role) FROM user_roles r WHERE r.user_id = u.id), '{}') AS roles,
              (SELECT count(*) FROM transfers t WHERE t.user_id = u.id)::text AS transfer_count
       FROM users u LEFT JOIN user_auth a ON a.user_id = u.id
       WHERE u.id = $1`,
      [id],
    );
    const u = rows[0];
    if (!u) {
      return null;
    }
    const links = await this.#pool.query<{
      provider: string;
      kyc_status: string;
      provider_customer_id: string | null;
      linked_at: Date;
      updated_at: Date;
    }>(
      `SELECT provider, kyc_status, provider_customer_id, linked_at, updated_at
       FROM provider_links WHERE user_id = $1 ORDER BY linked_at`,
      [id],
    );
    const audit = await this.#pool.query<{
      action: string;
      actor_type: string;
      created_at: Date;
    }>(
      `SELECT action, actor_type, created_at FROM audit_events
       WHERE entity_type = 'user' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [id],
    );
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      createdAt: u.created_at,
      kycStatus: links.rows.at(-1)?.kyc_status ?? null,
      emailVerified: u.email_verified,
      countryOfResidence: u.country,
      lastLoginAt: u.last_login_at,
      twoFactorEnabled: u.two_factor,
      roles: u.roles,
      providerLinks: links.rows.map((l) => ({
        provider: l.provider,
        kycStatus: l.kyc_status,
        providerCustomerId: l.provider_customer_id,
        linkedAt: l.linked_at,
        updatedAt: l.updated_at,
      })),
      transferCount: Number(u.transfer_count),
      recentAudit: audit.rows.map((a) => ({
        action: a.action,
        actorType: a.actor_type,
        createdAt: a.created_at,
      })),
    };
  }

  async searchTransfers(filter: {
    id?: string | undefined;
    userId?: string | undefined;
    status?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    limit: number;
    offset: number;
  }): Promise<AdminTransferRow[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.id) {
      const id = filter.id.trim();
      if (UUID.test(id)) {
        add('t.id = ?', id);
      } else {
        params.push(id);
        where.push(
          `(t.reference = $${params.length} OR t.provider_transfer_id = $${params.length})`,
        );
      }
    }
    if (filter.userId) add('t.user_id = ?', filter.userId);
    if (filter.status) add('t.status = ?', filter.status);
    if (filter.from) add('t.created_at >= ?', filter.from);
    if (filter.to) add('t.created_at < ?', filter.to);
    params.push(filter.limit, filter.offset);
    const { rows } = await this.#pool.query<TransferDbRow>(
      `SELECT ${TRANSFER_COLUMNS} FROM transfers t
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(toTransferRow);
  }

  async getTransfer(id: string): Promise<AdminTransferDetail | null> {
    if (!UUID.test(id)) {
      return null;
    }
    const { rows } = await this.#pool.query<
      TransferDbRow & {
        fee_amount_minor: string;
        total_to_pay_minor: string;
        exchange_rate: string;
        funding_method: string | null;
        provider_transfer_id: string | null;
        failure_reason: string | null;
      }
    >(
      `SELECT ${TRANSFER_COLUMNS}, t.fee_amount_minor::text AS fee_amount_minor,
              t.total_to_pay_minor::text AS total_to_pay_minor, t.exchange_rate::text AS exchange_rate,
              t.funding_method, t.provider_transfer_id, t.failure_reason
       FROM transfers t WHERE t.id = $1`,
      [id],
    );
    const t = rows[0];
    if (!t) {
      return null;
    }
    const events = await this.#pool.query<{
      from_status: string | null;
      status: string;
      source: string;
      reason: string | null;
      occurred_at: Date;
    }>(
      `SELECT from_status, status, source, reason, occurred_at
       FROM transfer_events WHERE transfer_id = $1 ORDER BY occurred_at, id`,
      [id],
    );
    const hooks = await this.#pool.query<WebhookDbRow>(
      `SELECT ${WEBHOOK_COLUMNS} FROM webhook_events
       WHERE related_transfer_id = $1 ORDER BY received_at`,
      [id],
    );
    return {
      ...toTransferRow(t),
      feeAmountMinor: t.fee_amount_minor,
      totalToPayMinor: t.total_to_pay_minor,
      exchangeRate: t.exchange_rate,
      fundingMethod: t.funding_method,
      providerTransferId: t.provider_transfer_id,
      failureReason: t.failure_reason,
      events: events.rows.map((e) => ({
        fromStatus: e.from_status,
        status: e.status,
        source: e.source,
        reason: e.reason,
        occurredAt: e.occurred_at,
      })),
      webhooks: hooks.rows.map(toWebhookRow),
    };
  }

  async stuckTransfers(filter: {
    olderThanHours: number;
    includeDrafts: boolean;
    limit: number;
    offset: number;
  }): Promise<AdminTransferRow[]> {
    const { rows } = await this.#pool.query<TransferDbRow>(
      `SELECT ${TRANSFER_COLUMNS} FROM transfers t
       WHERE t.status <> ALL($1::text[])
         AND ($2 OR t.status <> 'DRAFT')
         AND t.updated_at < now() - make_interval(hours => $3)
       ORDER BY t.updated_at
       LIMIT $4 OFFSET $5`,
      [FINAL, filter.includeDrafts, filter.olderThanHours, filter.limit, filter.offset],
    );
    return rows.map(toTransferRow);
  }

  async failedTransfers(filter: { limit: number; offset: number }): Promise<AdminTransferRow[]> {
    const { rows } = await this.#pool.query<TransferDbRow>(
      `SELECT ${TRANSFER_COLUMNS} FROM transfers t
       WHERE t.status IN ('FAILED', 'REFUNDED')
       ORDER BY t.updated_at DESC LIMIT $1 OFFSET $2`,
      [filter.limit, filter.offset],
    );
    return rows.map(toTransferRow);
  }

  async webhookErrors(filter: { limit: number; offset: number }): Promise<AdminWebhookRow[]> {
    const { rows } = await this.#pool.query<WebhookDbRow>(
      `SELECT ${WEBHOOK_COLUMNS} FROM webhook_events
       WHERE processing_status = 'failed' OR NOT signature_verified
       ORDER BY received_at DESC LIMIT $1 OFFSET $2`,
      [filter.limit, filter.offset],
    );
    return rows.map(toWebhookRow);
  }

  async identityReviews(filter: { limit: number; offset: number }): Promise<IdentityReviewRow[]> {
    const { rows } = await this.#pool.query<{
      user_id: string;
      email: string;
      provider: string;
      kyc_status: string;
      updated_at: Date;
    }>(
      `SELECT p.user_id, u.email::text AS email, p.provider, p.kyc_status, p.updated_at
       FROM provider_links p JOIN users u ON u.id = p.user_id
       WHERE p.kyc_status = 'REJECTED_PENDING_REVIEW'
       ORDER BY p.updated_at DESC LIMIT $1 OFFSET $2`,
      [filter.limit, filter.offset],
    );
    return rows.map((r): IdentityReviewRow => ({
      userId: r.user_id,
      email: r.email,
      provider: r.provider,
      kycStatus: r.kyc_status,
      updatedAt: r.updated_at,
    }));
  }

  async volume(filter: { period: 'day' | 'month'; from: Date; to: Date }): Promise<VolumeRow[]> {
    // `period` is one of two literals (validated by the caller and re-checked here).
    const unit = filter.period === 'month' ? 'month' : 'day';
    const { rows } = await this.#pool.query<{
      period: string;
      currency: string;
      transfers: string;
      completed: string;
      volume_minor: string;
    }>(
      `SELECT to_char(date_trunc('${unit}', t.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
              t.source_currency AS currency,
              count(*)::text AS transfers,
              count(*) FILTER (WHERE t.status = 'COMPLETED')::text AS completed,
              coalesce(sum(t.source_amount_minor) FILTER (WHERE t.status = ANY($3::text[])), 0)::text
                AS volume_minor
       FROM transfers t
       WHERE t.created_at >= $1 AND t.created_at < $2
         AND t.status NOT IN ('DRAFT', 'CANCELLED')
       GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
      [filter.from, filter.to, MONEY_TAKEN],
    );
    return rows.map((r) => ({
      period: r.period,
      currency: r.currency.trim(),
      transfers: Number(r.transfers),
      completed: Number(r.completed),
      volumeMinor: r.volume_minor,
    }));
  }
}
