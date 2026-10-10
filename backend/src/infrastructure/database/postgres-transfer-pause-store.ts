import {
  DEFAULT_PAUSE_MESSAGE,
  type PauseState,
  type TransferPauseStore,
} from '../../application/settings/transfer-pause.ts';
import type { DatabasePool } from './pool.ts';

const KEY = 'transfers_paused';

export class PostgresTransferPauseStore implements TransferPauseStore {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async get(): Promise<PauseState> {
    const { rows } = await this.#pool.query<{
      value: { paused?: boolean; message?: string };
      updated_at: Date;
    }>(`SELECT value, updated_at FROM system_settings WHERE key = $1`, [KEY]);
    const row = rows[0];
    return {
      paused: row?.value.paused === true,
      message: row?.value.message ?? DEFAULT_PAUSE_MESSAGE,
      updatedAt: row?.updated_at ?? null,
    };
  }

  async set(state: { paused: boolean; message: string }, adminUserId: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [KEY, JSON.stringify(state), adminUserId],
    );
  }
}
