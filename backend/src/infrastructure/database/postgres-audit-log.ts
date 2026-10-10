import type { AuditLogEntry, StrictAuditLog } from '../../application/audit/audit-log.ts';
import type { Logger } from '../../shared/logger.ts';
import type { DatabasePool } from './pool.ts';

/**
 * Writes audit entries to the append-only `audit_events` table. A write failure
 * must never break the request that triggered it, so failures are logged and
 * swallowed.
 */
export class PostgresAuditLog implements StrictAuditLog {
  readonly #pool: DatabasePool;
  readonly #logger: Logger;

  constructor(pool: DatabasePool, logger: Logger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  async recordStrict(entry: AuditLogEntry): Promise<void> {
    await this.#pool.query(
      `INSERT INTO audit_events
         (actor_type, actor_id, action, entity_type, entity_id, context, request_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::inet)`,
      [
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.context ?? {}),
        entry.requestId ?? null,
        entry.ipAddress ?? null,
      ],
    );
  }

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.recordStrict(entry);
    } catch (error) {
      this.#logger.error('audit.write_failed', { action: entry.action, error });
    }
  }
}
