import type {
  AdminAlert,
  AdminAlerts,
  NewAdminAlert,
} from '../../application/notifications/admin-alerts.ts';
import type { Logger } from '../../shared/logger.ts';
import type { DatabasePool } from './pool.ts';

interface AlertRow {
  id: string;
  kind: string;
  severity: 'low' | 'medium' | 'high';
  entity_type: string;
  entity_id: string;
  message: string;
  context: Record<string, unknown>;
  status: 'open' | 'resolved';
  occurrences: number;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
}

/** Admin alerts in the database, each also written to the log as an error. */
export class PostgresAdminAlerts implements AdminAlerts {
  readonly #pool: DatabasePool;
  readonly #logger: Logger;
  constructor(pool: DatabasePool, logger: Logger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  async raise(alert: NewAdminAlert): Promise<void> {
    // Logged first, so the alert is visible even if the database write fails.
    this.#logger.error(`admin.alert.${alert.kind.toLowerCase()}`, {
      entityType: alert.entityType,
      entityId: alert.entityId,
      ...alert.context,
    });
    await this.#pool.query(
      `INSERT INTO admin_alerts (kind, severity, entity_type, entity_id, message, context)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (kind, entity_type, entity_id) WHERE status = 'open'
       DO UPDATE SET occurrences = admin_alerts.occurrences + 1, last_seen_at = now(),
                     context = EXCLUDED.context`,
      [
        alert.kind,
        alert.severity,
        alert.entityType,
        alert.entityId,
        alert.message,
        JSON.stringify(alert.context ?? {}),
      ],
    );
  }

  async list(filter: {
    status: 'open' | 'resolved' | 'all';
    limit: number;
  }): Promise<AdminAlert[]> {
    const { rows } = await this.#pool.query<AlertRow>(
      `SELECT * FROM admin_alerts WHERE ($1 = 'all' OR status = $1)
       ORDER BY last_seen_at DESC LIMIT $2`,
      [filter.status, filter.limit],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      entityType: row.entity_type,
      entityId: row.entity_id,
      message: row.message,
      context: row.context,
      status: row.status,
      occurrences: row.occurrences,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      resolvedAt: row.resolved_at ?? undefined,
    }));
  }

  async resolve(id: string, adminUserId: string): Promise<boolean> {
    const { rowCount } = await this.#pool.query(
      `UPDATE admin_alerts SET status = 'resolved', resolved_at = now(), resolved_by = $2
       WHERE id = $1 AND status = 'open'`,
      [id, adminUserId],
    );
    return (rowCount ?? 0) > 0;
  }
}
