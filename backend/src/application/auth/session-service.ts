import { generateSecretToken, hashSecretToken } from '../../shared/secret-token.ts';
import type { Role } from '../../domain/auth/principal.ts';
import type { IssuedTokens, RevocationReason } from '../../domain/auth/session.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { TokenService } from './token-service.ts';
import type { SessionStore } from './session-store.ts';

export class InvalidRefreshTokenError extends Error {
  constructor(message = 'The refresh token is invalid or has expired.') {
    super(message);
    this.name = 'InvalidRefreshTokenError';
  }
}

export interface StartSessionInput {
  readonly userId: string;
  readonly roles: readonly Role[];
  readonly emailVerified: boolean;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface RotateSessionInput {
  readonly refreshToken: string;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface SessionServiceDeps {
  readonly tokenService: TokenService;
  readonly sessionStore: SessionStore;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
  readonly refreshTokenTtlDays: number;
  readonly accessTokenTtlSeconds: number;
}

/**
 * Owns the refresh-token lifecycle: issue, rotate-on-use, and reuse detection.
 *
 * Every refresh rotates: the old token becomes `rotated` and a new one is
 * issued in the same family. If a `rotated`/`revoked` refresh token is ever
 * presented again, the entire family is revoked (a stolen token and the real
 * one are indistinguishable, so both are invalidated).
 */
export class SessionService {
  readonly #deps: SessionServiceDeps;

  constructor(deps: SessionServiceDeps) {
    this.#deps = deps;
  }

  async startSession(input: StartSessionInput): Promise<IssuedTokens> {
    const { raw, hash } = generateSecretToken();
    const expiresAt = this.#refreshExpiry();

    const session = await this.#deps.sessionStore.create({
      userId: input.userId,
      roles: input.roles,
      refreshTokenHash: hash,
      expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    const accessToken = await this.#deps.tokenService.issueAccessToken({
      userId: input.userId,
      roles: input.roles,
      sessionId: session.id,
      emailVerified: input.emailVerified,
    });

    return {
      accessToken,
      refreshToken: raw,
      accessTokenExpiresInSeconds: this.#deps.accessTokenTtlSeconds,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async rotateSession(input: RotateSessionInput): Promise<IssuedTokens> {
    const presentedHash = hashSecretToken(input.refreshToken);
    const record = await this.#deps.sessionStore.findByRefreshTokenHash(presentedHash);

    if (!record) {
      throw new InvalidRefreshTokenError();
    }

    const now = this.#deps.clock();

    if (record.status !== 'active') {
      // A rotated or revoked token was replayed – treat the whole family as compromised.
      await this.#deps.sessionStore.revokeFamily(record.familyId, 'refresh_token_reuse');
      await this.#deps.auditLog.record({
        actorType: 'system',
        action: 'auth.refresh.reuse_detected',
        entityType: 'auth_session',
        entityId: record.id,
        context: { familyId: record.familyId },
      });
      throw new InvalidRefreshTokenError();
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      await this.#deps.sessionStore.revoke(record.id, 'expired');
      throw new InvalidRefreshTokenError();
    }

    if (record.userStatus !== 'active') {
      await this.#deps.sessionStore.revokeFamily(record.familyId, 'logout_all');
      throw new InvalidRefreshTokenError();
    }

    const { raw, hash } = generateSecretToken();
    const expiresAt = this.#refreshExpiry();

    const next = await this.#deps.sessionStore.create({
      userId: record.userId,
      roles: record.roles,
      familyId: record.familyId,
      previousSessionId: record.id,
      refreshTokenHash: hash,
      expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });
    await this.#deps.sessionStore.markRotated(record.id);

    const accessToken = await this.#deps.tokenService.issueAccessToken({
      userId: record.userId,
      roles: record.roles,
      sessionId: next.id,
      emailVerified: record.emailVerified,
    });

    return {
      accessToken,
      refreshToken: raw,
      accessTokenExpiresInSeconds: this.#deps.accessTokenTtlSeconds,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async endSession(sessionId: string, reason: RevocationReason): Promise<void> {
    await this.#deps.sessionStore.revoke(sessionId, reason);
  }

  async endAllSessions(userId: string, reason: RevocationReason): Promise<number> {
    return this.#deps.sessionStore.revokeAllForUser(userId, reason);
  }

  #refreshExpiry(): Date {
    return new Date(
      this.#deps.clock().getTime() + this.#deps.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
  }
}
