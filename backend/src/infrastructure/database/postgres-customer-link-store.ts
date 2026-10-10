import type {
  CustomerLinkRecord,
  CustomerLinkStore,
  CustomerStatusUpdate,
  KycStatus,
} from '../../application/transfer/ports.ts';
import type {
  CustomerStatus,
  ProviderCustomerLink,
  ProviderName,
} from '../../domain/payout/models.ts';
import type { TokenCipher } from '../crypto/token-cipher.ts';
import type { DatabasePool } from './pool.ts';

interface LinkRow {
  provider: ProviderName;
  provider_customer_id: string | null;
  provider_profile_id: string | null;
  kyc_status: KycStatus;
}

/** Binds an encrypted token to the row it belongs to. */
function tokenContext(userId: string, provider: ProviderName): string {
  return `provider_links:${userId}:${provider}`;
}

/**
 * `provider_links`: one row per (user, provider). Refresh tokens are encrypted
 * by the application before they reach the database and are never logged.
 */
export class PostgresCustomerLinkStore implements CustomerLinkStore {
  readonly #pool: DatabasePool;
  readonly #cipher: TokenCipher | null;

  constructor(pool: DatabasePool, cipher: TokenCipher | null) {
    this.#pool = pool;
    this.#cipher = cipher;
  }

  async find(userId: string, provider: ProviderName): Promise<CustomerLinkRecord | null> {
    const { rows } = await this.#pool.query<LinkRow>(
      `SELECT provider, provider_customer_id, provider_profile_id, kyc_status
       FROM provider_links WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
    const row = rows[0];
    if (!row?.provider_customer_id) {
      return null;
    }
    return {
      link: {
        provider: row.provider,
        customerRef: row.provider_customer_id,
        ...(row.provider_profile_id ? { profileRef: row.provider_profile_id } : {}),
      },
      status: row.kyc_status,
    };
  }

  async status(userId: string, provider: ProviderName): Promise<KycStatus | null> {
    const { rows } = await this.#pool.query<{ kyc_status: KycStatus }>(
      `SELECT kyc_status FROM provider_links WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
    return rows[0]?.kyc_status ?? null;
  }

  async beginLink(userId: string, provider: ProviderName): Promise<void> {
    await this.#pool.query(
      `INSERT INTO provider_links (user_id, provider, kyc_status) VALUES ($1, $2, 'PENDING')
       ON CONFLICT (user_id, provider) DO NOTHING`,
      [userId, provider],
    );
  }

  /**
   * Linking to a different provider customer (or for the first time) resets the
   * status to PENDING and discards any stored token: both belonged to the old
   * link. Saving the same customer again changes nothing.
   */
  async saveLink(userId: string, link: ProviderCustomerLink): Promise<void> {
    await this.#pool.query(
      `INSERT INTO provider_links (user_id, provider, provider_customer_id, provider_profile_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         provider_profile_id = EXCLUDED.provider_profile_id,
         kyc_status = CASE
           WHEN provider_links.provider_customer_id IS NOT DISTINCT FROM EXCLUDED.provider_customer_id
           THEN provider_links.kyc_status ELSE 'PENDING' END,
         encrypted_refresh_token = CASE
           WHEN provider_links.provider_customer_id IS NOT DISTINCT FROM EXCLUDED.provider_customer_id
           THEN provider_links.encrypted_refresh_token END,
         token_key_version = CASE
           WHEN provider_links.provider_customer_id IS NOT DISTINCT FROM EXCLUDED.provider_customer_id
           THEN provider_links.token_key_version END,
         provider_customer_id = EXCLUDED.provider_customer_id`,
      [userId, link.provider, link.customerRef, link.profileRef ?? null],
    );
  }

  async recordProviderStatus(
    userId: string,
    provider: ProviderName,
    status: CustomerStatus,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE provider_links SET kyc_status = $3
       WHERE user_id = $1 AND provider = $2
         AND provider_customer_id IS NOT NULL
         AND kyc_status <> 'REJECTED_PENDING_REVIEW'
         AND NOT ($3 = 'VERIFIED' AND identity_checked_at IS NULL)`,
      [userId, provider, status],
    );
  }

  async markIdentityChecked(userId: string, provider: ProviderName): Promise<void> {
    await this.#pool.query(
      `UPDATE provider_links SET identity_checked_at = COALESCE(identity_checked_at, now())
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
  }

  async recordProviderStatusByRef(
    provider: ProviderName,
    providerRef: string,
    status: CustomerStatus,
    occurredAt: Date,
  ): Promise<CustomerStatusUpdate> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        user_id: string;
        kyc_status: KycStatus;
        provider_status_at: Date | null;
        identity_checked_at: Date | null;
      }>(
        `SELECT id, user_id, kyc_status, provider_status_at, identity_checked_at
         FROM provider_links
         WHERE provider = $1 AND (provider_customer_id = $2 OR provider_profile_id = $2)
         FOR UPDATE`,
        [provider, providerRef],
      );
      const row = rows[0];
      let result: CustomerStatusUpdate;
      if (!row) {
        result = { outcome: 'unknown_customer' };
      } else if (row.kyc_status === 'REJECTED_PENDING_REVIEW') {
        result = { outcome: 'held_for_review', userId: row.user_id };
      } else if (row.provider_status_at && row.provider_status_at > occurredAt) {
        result = { outcome: 'stale', userId: row.user_id };
      } else if (status === 'VERIFIED' && !row.identity_checked_at) {
        result = { outcome: 'identity_not_checked', userId: row.user_id };
      } else if (row.kyc_status === status) {
        await client.query(`UPDATE provider_links SET provider_status_at = $2 WHERE id = $1`, [
          row.id,
          occurredAt,
        ]);
        result = { outcome: 'unchanged', userId: row.user_id };
      } else {
        await client.query(
          `UPDATE provider_links SET kyc_status = $2, provider_status_at = $3 WHERE id = $1`,
          [row.id, status, occurredAt],
        );
        result = { outcome: 'applied', userId: row.user_id, previous: row.kyc_status };
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async flagIdentityMismatch(userId: string, provider: ProviderName): Promise<void> {
    await this.#pool.query(
      `UPDATE provider_links SET kyc_status = 'REJECTED_PENDING_REVIEW'
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
  }

  async markNeedsRelink(provider: ProviderName, customerRef: string): Promise<void> {
    await this.#pool.query(
      `UPDATE provider_links SET kyc_status = 'NEEDS_RELINK'
       WHERE provider = $1 AND provider_customer_id = $2
         AND kyc_status <> 'REJECTED_PENDING_REVIEW'`,
      [provider, customerRef],
    );
  }

  async saveRefreshToken(
    userId: string,
    provider: ProviderName,
    refreshToken: string,
  ): Promise<void> {
    const encrypted = this.#requireCipher().encrypt(refreshToken, tokenContext(userId, provider));
    const { rowCount } = await this.#pool.query(
      `UPDATE provider_links SET encrypted_refresh_token = $3, token_key_version = $4
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider, encrypted.ciphertext, encrypted.keyVersion],
    );
    if (rowCount !== 1) {
      throw new Error('Cannot store a refresh token: the customer has no link to that provider');
    }
  }

  /** Re-encrypts with the current key when the stored value used an older one. */
  async readRefreshToken(userId: string, provider: ProviderName): Promise<string | null> {
    const { rows } = await this.#pool.query<{
      encrypted_refresh_token: string | null;
      token_key_version: number | null;
    }>(
      `SELECT encrypted_refresh_token, token_key_version
       FROM provider_links WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
    const row = rows[0];
    if (!row?.encrypted_refresh_token || row.token_key_version === null) {
      return null;
    }
    const cipher = this.#requireCipher();
    const stored = { ciphertext: row.encrypted_refresh_token, keyVersion: row.token_key_version };
    const refreshToken = cipher.decrypt(stored, tokenContext(userId, provider));
    if (cipher.needsRotation(stored)) {
      await this.saveRefreshToken(userId, provider, refreshToken);
    }
    return refreshToken;
  }

  async #userOf(provider: ProviderName, customerRef: string): Promise<string | null> {
    const { rows } = await this.#pool.query<{ user_id: string }>(
      `SELECT user_id FROM provider_links
       WHERE provider = $1 AND (provider_customer_id = $2 OR provider_profile_id = $2)`,
      [provider, customerRef],
    );
    return rows[0]?.user_id ?? null;
  }

  async readRefreshTokenByRef(provider: ProviderName, customerRef: string): Promise<string | null> {
    const userId = await this.#userOf(provider, customerRef);
    return userId ? this.readRefreshToken(userId, provider) : null;
  }

  async saveRefreshTokenByRef(
    provider: ProviderName,
    customerRef: string,
    refreshToken: string,
  ): Promise<void> {
    const userId = await this.#userOf(provider, customerRef);
    if (!userId) {
      throw new Error('Cannot store a refresh token: no customer is linked with that reference');
    }
    await this.saveRefreshToken(userId, provider, refreshToken);
  }

  #requireCipher(): TokenCipher {
    if (!this.#cipher) {
      throw new Error(
        'ENCRYPTION_KEY is not configured: provider tokens cannot be stored or read.',
      );
    }
    return this.#cipher;
  }
}
