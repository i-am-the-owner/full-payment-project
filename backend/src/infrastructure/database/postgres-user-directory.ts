import type {
  UserDirectory,
  UserSummary,
  UserAccountStatus,
} from '../../application/auth/user-directory.ts';
import type { DatabasePool } from './pool.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  email: string;
  status: UserAccountStatus;
  email_verified_at: Date | null;
}

export class PostgresUserDirectory implements UserDirectory {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async findById(id: string): Promise<UserSummary | null> {
    // `id` comes from a verified token, but guard anyway so a malformed value
    // is a clean "not found" rather than a database type error.
    if (!UUID_PATTERN.test(id)) {
      return null;
    }

    const { rows } = await this.#pool.query<UserRow>(
      `SELECT id, email, status, email_verified_at FROM users WHERE id = $1`,
      [id],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      status: row.status,
      emailVerified: row.email_verified_at !== null,
    };
  }
}
