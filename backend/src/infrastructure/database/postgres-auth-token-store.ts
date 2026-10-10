import type {
  AuthTokenPurpose,
  AuthTokenStore,
  IssueAuthTokenInput,
} from '../../application/auth/auth-token-store.ts';
import type { DatabasePool } from './pool.ts';

export class PostgresAuthTokenStore implements AuthTokenStore {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async issue(input: IssueAuthTokenInput): Promise<void> {
    await this.#pool.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, ip_address)
       VALUES ($1, $2, $3, $4, $5::inet)`,
      [input.userId, input.purpose, input.tokenHash, input.expiresAt, input.ipAddress ?? null],
    );
  }

  async consume(input: {
    purpose: AuthTokenPurpose;
    tokenHash: string;
  }): Promise<{ userId: string } | null> {
    // One statement: mark consumed and return the owner, only if still valid.
    const { rows } = await this.#pool.query<{ user_id: string }>(
      `UPDATE auth_tokens
       SET consumed_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [input.tokenHash, input.purpose],
    );
    return rows[0] ? { userId: rows[0].user_id } : null;
  }

  async invalidateAllPending(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await this.#pool.query(
      `UPDATE auth_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose],
    );
  }
}
