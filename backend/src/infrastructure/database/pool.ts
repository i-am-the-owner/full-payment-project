import pg from 'pg';

/**
 * Ensures monetary and identifier columns are read back as safe JavaScript
 * types:
 *  - BIGINT (OID 20) → string, never a lossy `number`. Callers convert to
 *    `BigInt` explicitly. Money is stored in integer minor units.
 *  - NUMERIC (OID 1700) → string, preserving exact decimal precision (used for
 *    exchange rates).
 */
pg.types.setTypeParser(20, (value) => value);
pg.types.setTypeParser(1700, (value) => value);

export type DatabasePool = pg.Pool;

export interface DatabasePoolOptions {
  max?: number;
  /** Per-statement timeout. Omit for migrations (long DDL); set for the app. */
  statementTimeoutMs?: number;
}

export function createDatabasePool(
  connectionString: string,
  options: DatabasePoolOptions = {},
): DatabasePool {
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(options.statementTimeoutMs ? { statement_timeout: options.statementTimeoutMs } : {}),
    application_name: 'almapay-backend',
  });
}
