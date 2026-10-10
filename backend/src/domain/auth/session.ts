export type SessionStatus = 'active' | 'rotated' | 'revoked';

/** A refresh-token session. The raw refresh token is never stored or returned in this shape. */
export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly status: SessionStatus;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly expiresAt: Date;
}

export type RevocationReason =
  | 'logout'
  | 'logout_all'
  | 'refresh_token_reuse'
  | 'password_changed'
  | 'password_reset'
  | 'admin_suspended'
  | 'expired';

/** The credentials returned to a client after login / registration / refresh. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresInSeconds: number;
  readonly refreshTokenExpiresAt: Date;
}
