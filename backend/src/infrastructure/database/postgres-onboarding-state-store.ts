import type { OnboardingStateStore } from '../../application/transfer/ports.ts';
import { isProviderName, type ProviderName } from '../../domain/payout/models.ts';
import type { DatabasePool } from './pool.ts';

export class PostgresOnboardingStateStore implements OnboardingStateStore {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async create(input: {
    userId: string;
    provider: ProviderName;
    stateHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO onboarding_states (user_id, provider, state_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.userId, input.provider, input.stateHash, input.expiresAt],
    );
  }

  /** One statement, so two requests with the same state cannot both succeed. */
  async consume(
    stateHash: string,
    now: Date,
  ): Promise<{ userId: string; provider: ProviderName } | null> {
    const { rows } = await this.#pool.query<{ user_id: string; provider: string }>(
      `UPDATE onboarding_states SET used_at = $2
       WHERE state_hash = $1 AND used_at IS NULL AND expires_at > $2
       RETURNING user_id, provider`,
      [stateHash, now],
    );
    const row = rows[0];
    if (!row || !isProviderName(row.provider)) {
      return null;
    }
    return { userId: row.user_id, provider: row.provider };
  }
}
