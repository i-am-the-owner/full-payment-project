import type { RecoveryCodeStore } from '../../application/auth/two-factor.ts';
import type { DatabasePool } from './pool.ts';

/** One-time two-step recovery codes. Only hashes are stored. */
export class PostgresRecoveryCodeStore implements RecoveryCodeStore {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async replaceAll(userId: string, hashes: readonly string[]): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM two_factor_recovery_codes WHERE user_id = $1`, [userId]);
      for (const hash of hashes) {
        await client.query(
          `INSERT INTO two_factor_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
          [userId, hash],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** One statement: the same code cannot be accepted twice, even by concurrent requests. */
  async consume(userId: string, hash: string): Promise<boolean> {
    const { rowCount } = await this.#pool.query(
      `UPDATE two_factor_recovery_codes SET used_at = now()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
      [userId, hash],
    );
    return (rowCount ?? 0) === 1;
  }

  async remaining(userId: string): Promise<number> {
    const { rows } = await this.#pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM two_factor_recovery_codes
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  async deleteAll(userId: string): Promise<void> {
    await this.#pool.query(`DELETE FROM two_factor_recovery_codes WHERE user_id = $1`, [userId]);
  }
}
