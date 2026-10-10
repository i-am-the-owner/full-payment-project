import type { TotpState, TotpStore } from '../../application/auth/two-factor.ts';
import type { TokenCipher } from '../crypto/token-cipher.ts';
import type { DatabasePool } from './pool.ts';

/** TOTP secrets on `user_auth`, encrypted by the application before storage. */
export class PostgresTotpStore implements TotpStore {
  readonly #pool: DatabasePool;
  readonly #cipher: TokenCipher | null;

  constructor(pool: DatabasePool, cipher: TokenCipher | null) {
    this.#pool = pool;
    this.#cipher = cipher;
  }

  get available(): boolean {
    return this.#cipher !== null;
  }

  async get(userId: string): Promise<TotpState> {
    const { rows } = await this.#pool.query<{
      totp_secret_encrypted: string | null;
      totp_key_version: number | null;
      totp_enabled_at: Date | null;
    }>(
      `SELECT totp_secret_encrypted, totp_key_version, totp_enabled_at
       FROM user_auth WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!this.#cipher || !row?.totp_secret_encrypted || row.totp_key_version === null) {
      return { secret: null, enabled: false };
    }
    return {
      secret: this.#cipher.decrypt(
        { ciphertext: row.totp_secret_encrypted, keyVersion: row.totp_key_version },
        `user_auth.totp:${userId}`,
      ),
      enabled: row.totp_enabled_at !== null,
    };
  }

  async savePendingSecret(userId: string, secret: string): Promise<void> {
    if (!this.#cipher) {
      throw new Error('ENCRYPTION_KEY is not configured: a TOTP secret cannot be stored.');
    }
    const encrypted = this.#cipher.encrypt(secret, `user_auth.totp:${userId}`);
    await this.#pool.query(
      `UPDATE user_auth
       SET totp_secret_encrypted = $2, totp_key_version = $3, totp_enabled_at = NULL,
           totp_last_counter = NULL
       WHERE user_id = $1`,
      [userId, encrypted.ciphertext, encrypted.keyVersion],
    );
  }

  async enable(userId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE user_auth SET totp_enabled_at = now()
       WHERE user_id = $1 AND totp_secret_encrypted IS NOT NULL`,
      [userId],
    );
  }

  async disable(userId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE user_auth
       SET totp_secret_encrypted = NULL, totp_key_version = NULL, totp_enabled_at = NULL,
           totp_last_counter = NULL
       WHERE user_id = $1`,
      [userId],
    );
  }

  /** One statement, so the same code cannot be accepted by two concurrent requests. */
  async consumeCounter(userId: string, counter: number): Promise<boolean> {
    const { rowCount } = await this.#pool.query(
      `UPDATE user_auth SET totp_last_counter = $2
       WHERE user_id = $1 AND (totp_last_counter IS NULL OR totp_last_counter < $2)`,
      [userId, counter],
    );
    return rowCount === 1;
  }
}
