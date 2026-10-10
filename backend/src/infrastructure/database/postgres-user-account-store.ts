import type {
  RecordFailedLoginOptions,
  UserAccountRecord,
  UserAccountStore,
} from '../../application/auth/user-account-store.ts';
import type { UserAccountStatus } from '../../application/auth/user-directory.ts';
import type { DatabasePool } from './pool.ts';

interface AccountRow {
  id: string;
  email: string;
  status: UserAccountStatus;
  email_verified_at: Date | null;
  password_hash: string | null;
  failed_login_attempts: number | string;
  locked_until: Date | null;
}

const SELECT = `
  SELECT u.id, u.email, u.status, u.email_verified_at,
         a.password_hash, a.failed_login_attempts, a.locked_until
  FROM users u
  JOIN user_auth a ON a.user_id = u.id
`;

function toRecord(row: AccountRow): UserAccountRecord {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    emailVerified: row.email_verified_at !== null,
    passwordHash: row.password_hash,
    failedLoginAttempts: Number(row.failed_login_attempts),
    lockedUntil: row.locked_until,
  };
}

export class PostgresUserAccountStore implements UserAccountStore {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async findByEmail(email: string): Promise<UserAccountRecord | null> {
    const { rows } = await this.#pool.query<AccountRow>(`${SELECT} WHERE u.email = $1`, [email]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<UserAccountRecord | null> {
    const { rows } = await this.#pool.query<AccountRow>(`${SELECT} WHERE u.id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async createAccount(input: { email: string; passwordHash: string }): Promise<{ id: string }> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [input.email],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO user_auth (user_id, password_hash, password_algorithm, password_updated_at)
         VALUES ($1, $2, 'argon2id', now())`,
        [id, input.passwordHash],
      );
      await client.query('COMMIT');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.#pool.query(
      `UPDATE user_auth
       SET password_hash = $2, password_algorithm = 'argon2id', password_updated_at = now(),
           failed_login_attempts = 0, locked_until = NULL
       WHERE user_id = $1`,
      [userId, passwordHash],
    );
  }

  async setStatus(userId: string, status: UserAccountStatus): Promise<void> {
    await this.#pool.query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, status]);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`,
      [userId],
    );
  }

  async recordFailedLogin(
    userId: string,
    options: RecordFailedLoginOptions,
  ): Promise<{ locked: boolean }> {
    const { rows } = await this.#pool.query<{ locked: boolean }>(
      `UPDATE user_auth
       SET failed_login_attempts = failed_login_attempts + 1,
           locked_until = CASE
             WHEN failed_login_attempts + 1 >= $2
             THEN now() + make_interval(mins => $3)
             ELSE locked_until
           END
       WHERE user_id = $1
       RETURNING (locked_until IS NOT NULL AND locked_until > now()) AS locked`,
      [userId, options.lockThreshold, options.lockDurationMinutes],
    );
    return { locked: rows[0]?.locked ?? false };
  }

  async recordSuccessfulLogin(userId: string, ipAddress: string | undefined): Promise<void> {
    await this.#pool.query(
      `UPDATE user_auth
       SET failed_login_attempts = 0, locked_until = NULL,
           last_login_at = now(), last_login_ip = $2::inet
       WHERE user_id = $1`,
      [userId, ipAddress ?? null],
    );
  }
}
