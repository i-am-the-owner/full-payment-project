import type { NotificationLog } from '../../application/notifications/ports.ts';
import type { DatabasePool } from './pool.ts';

export class PostgresNotificationLog implements NotificationLog {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async wasSent(transferId: string, kind: string): Promise<boolean> {
    const { rows } = await this.#pool.query(
      `SELECT 1 FROM transfer_notifications WHERE transfer_id = $1 AND kind = $2 AND channel = 'email'`,
      [transferId, kind],
    );
    return rows.length > 0;
  }

  async markSent(transferId: string, userId: string, kind: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO transfer_notifications (transfer_id, user_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [transferId, userId, kind],
    );
  }
}
