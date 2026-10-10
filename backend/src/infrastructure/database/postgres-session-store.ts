import type {
  ActiveSessionCheck,
  CreateSessionInput,
  SessionRecord,
  SessionStore,
} from '../../application/auth/session-store.ts';
import type { Role } from '../../domain/auth/principal.ts';
import type { Session, RevocationReason, SessionStatus } from '../../domain/auth/session.ts';
import type { UserAccountStatus } from '../../application/auth/user-directory.ts';
import type { DatabasePool } from './pool.ts';

interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  roles: string[];
  status: SessionStatus;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
}

interface SessionWithUserRow extends SessionRow {
  user_status: UserAccountStatus;
  email_verified_at: Date | null;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    status: row.status,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

export class PostgresSessionStore implements SessionStore {
  readonly #pool: DatabasePool;
  readonly #activeProvider: string;

  /**
   * @param activeProvider the payout provider in use. A customer counts as
   *   provider-verified only through a VERIFIED link to *that* provider.
   */
  constructor(pool: DatabasePool, activeProvider: string) {
    this.#pool = pool;
    this.#activeProvider = activeProvider;
  }

  async create(input: CreateSessionInput): Promise<Session> {
    const { rows } = await this.#pool.query<SessionRow>(
      `INSERT INTO auth_sessions
         (user_id, family_id, roles, refresh_token_hash, previous_session_id,
          user_agent, ip_address, expires_at)
       VALUES ($1, COALESCE($2, gen_random_uuid()), $3::text[], $4, $5, $6, $7::inet, $8)
       RETURNING id, user_id, family_id, roles, status, created_at, last_used_at, expires_at`,
      [
        input.userId,
        input.familyId ?? null,
        input.roles as readonly string[],
        input.refreshTokenHash,
        input.previousSessionId ?? null,
        input.userAgent ?? null,
        input.ipAddress ?? null,
        input.expiresAt,
      ],
    );
    return toSession(rows[0]!);
  }

  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    const { rows } = await this.#pool.query<SessionWithUserRow>(
      `SELECT s.id, s.user_id, s.family_id, s.roles, s.status, s.created_at, s.last_used_at,
              s.expires_at, u.status AS user_status, u.email_verified_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1`,
      [hash],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      ...toSession(row),
      roles: row.roles as Role[],
      userStatus: row.user_status,
      emailVerified: row.email_verified_at !== null,
    };
  }

  async findActiveWithUser(sessionId: string): Promise<ActiveSessionCheck | null> {
    const { rows } = await this.#pool.query<{
      user_id: string;
      user_status: UserAccountStatus;
      email_verified_at: Date | null;
      kyc_status: string | null;
    }>(
      `SELECT s.user_id, u.status AS user_status, u.email_verified_at,
              (SELECT l.kyc_status FROM provider_links l
               WHERE l.user_id = u.id AND l.provider = $2) AS kyc_status
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.status = 'active' AND s.expires_at > now()`,
      [sessionId, this.#activeProvider],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      userId: row.user_id,
      userStatus: row.user_status,
      emailVerified: row.email_verified_at !== null,
      providerVerified: row.kyc_status === 'VERIFIED',
      needsRelink: row.kyc_status === 'NEEDS_RELINK',
    };
  }

  async markRotated(sessionId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE auth_sessions SET status = 'rotated', last_used_at = now()
       WHERE id = $1 AND status = 'active'`,
      [sessionId],
    );
  }

  async touch(sessionId: string): Promise<void> {
    await this.#pool.query(`UPDATE auth_sessions SET last_used_at = now() WHERE id = $1`, [
      sessionId,
    ]);
  }

  async revoke(sessionId: string, reason: RevocationReason): Promise<void> {
    await this.#pool.query(
      `UPDATE auth_sessions
       SET status = 'revoked', revoked_at = now(), revoked_reason = $2
       WHERE id = $1 AND status <> 'revoked'`,
      [sessionId, reason],
    );
  }

  async revokeFamily(familyId: string, reason: RevocationReason): Promise<number> {
    const { rowCount } = await this.#pool.query(
      `UPDATE auth_sessions
       SET status = 'revoked', revoked_at = now(), revoked_reason = $2
       WHERE family_id = $1 AND status <> 'revoked'`,
      [familyId, reason],
    );
    return rowCount ?? 0;
  }

  async revokeAllForUser(userId: string, reason: RevocationReason): Promise<number> {
    const { rowCount } = await this.#pool.query(
      `UPDATE auth_sessions
       SET status = 'revoked', revoked_at = now(), revoked_reason = $2
       WHERE user_id = $1 AND status <> 'revoked'`,
      [userId, reason],
    );
    return rowCount ?? 0;
  }
}
