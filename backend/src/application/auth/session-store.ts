import type { Session, RevocationReason } from '../../domain/auth/session.ts';
import type { Role } from '../../domain/auth/principal.ts';
import type { UserAccountStatus } from './user-directory.ts';

export interface CreateSessionInput {
  readonly userId: string;
  readonly roles: readonly Role[];
  /** Omit to start a new family; pass the existing family id on rotation. */
  readonly familyId?: string;
  readonly previousSessionId?: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface SessionRecord extends Session {
  readonly roles: readonly Role[];
  readonly userStatus: UserAccountStatus;
  readonly emailVerified: boolean;
}

/** The data `authenticate` needs to validate an access token's session. */
export interface ActiveSessionCheck {
  readonly userId: string;
  readonly userStatus: UserAccountStatus;
  readonly emailVerified: boolean;
  /** Whether the payout provider reports this customer as verified (KYC). */
  readonly providerVerified: boolean;
  /** The provider no longer accepts the customer's connection: they must reconnect. */
  readonly needsRelink: boolean;
}

export interface SessionStore {
  create(input: CreateSessionInput): Promise<Session>;

  /** Looks up a session by the SHA-256 hash of its refresh token (any status). */
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | null>;

  /** Returns account context iff the session is active and unexpired; null otherwise. */
  findActiveWithUser(sessionId: string): Promise<ActiveSessionCheck | null>;

  markRotated(sessionId: string): Promise<void>;
  touch(sessionId: string): Promise<void>;
  revoke(sessionId: string, reason: RevocationReason): Promise<void>;
  revokeFamily(familyId: string, reason: RevocationReason): Promise<number>;
  revokeAllForUser(userId: string, reason: RevocationReason): Promise<number>;
}
