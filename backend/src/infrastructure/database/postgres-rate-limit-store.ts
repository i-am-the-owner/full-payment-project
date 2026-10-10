import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import type { Logger } from '../../shared/logger.ts';
import type { DatabasePool } from './pool.ts';

/**
 * A rate-limit store that counts in Postgres, so the limit holds across every
 * app instance (the default in-memory store counts per process). One atomic
 * upsert per request: no read-then-write race.
 *
 * Each limiter gets its own `prefix`, so limiters do not share a counter. The
 * prefix must be stable across instances, which it is when instances run the
 * same code.
 */
export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  readonly #pool: DatabasePool;
  readonly #logger: Logger;
  #windowMs = 60_000;
  static #lastCleanup = 0;

  constructor(pool: DatabasePool, logger: Logger, prefix: string) {
    this.#pool = pool;
    this.#logger = logger;
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.#windowMs = options.windowMs;
  }

  #key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await this.#pool.query<{ hits: number; reset_at: Date }>(
      `SELECT hits, reset_at FROM rate_limit_hits WHERE key = $1 AND reset_at > now()`,
      [this.#key(key)],
    );
    const row = rows[0];
    return row ? { totalHits: row.hits, resetTime: row.reset_at } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { rows } = await this.#pool.query<{ hits: number; reset_at: Date }>(
      `INSERT INTO rate_limit_hits (key, hits, reset_at)
       VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limit_hits.reset_at <= now() THEN 1 ELSE rate_limit_hits.hits + 1 END,
         reset_at = CASE WHEN rate_limit_hits.reset_at <= now()
                         THEN now() + make_interval(secs => $2) ELSE rate_limit_hits.reset_at END
       RETURNING hits, reset_at`,
      [this.#key(key), this.#windowMs / 1000],
    );
    this.#cleanupSometimes();
    return { totalHits: rows[0]!.hits, resetTime: rows[0]!.reset_at };
  }

  async decrement(key: string): Promise<void> {
    await this.#pool.query(
      `UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE key = $1`,
      [this.#key(key)],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.#pool.query(`DELETE FROM rate_limit_hits WHERE key = $1`, [this.#key(key)]);
  }

  async resetAll(): Promise<void> {
    await this.#pool.query(`DELETE FROM rate_limit_hits WHERE key LIKE $1`, [`${this.prefix}:%`]);
  }

  /** Expired rows are harmless but should not pile up: sweep at most once a minute. */
  #cleanupSometimes(): void {
    const now = Date.now();
    if (now - PostgresRateLimitStore.#lastCleanup < 60_000) return;
    PostgresRateLimitStore.#lastCleanup = now;
    this.#pool
      .query(`DELETE FROM rate_limit_hits WHERE reset_at < now() - interval '1 minute'`)
      .catch((error: unknown) => this.#logger.warn('ratelimit.cleanup_failed', { error }));
  }
}
