import type { AuthenticatedPrincipal, Role } from '../../domain/auth/principal.ts';

/** Claims required to mint an access token. */
export interface AccessTokenClaims {
  readonly userId: string;
  readonly roles: readonly Role[];
  /** The refresh-token session this access token belongs to. */
  readonly sessionId: string;
  readonly emailVerified: boolean;
}

/**
 * What a verified token proves. Provider verification (KYC) is deliberately
 * absent: it is never carried in a token, only read from the database.
 */
export type VerifiedTokenPrincipal = Omit<
  AuthenticatedPrincipal,
  'providerVerified' | 'needsRelink'
>;

/**
 * Issues and verifies short-lived access tokens (stateless JWTs). The long-lived
 * half of the session – refresh tokens – is handled by the session store.
 */
export interface TokenService {
  issueAccessToken(claims: AccessTokenClaims): Promise<string>;
  /**
   * Verifies signature, algorithm, issuer, audience and expiry, and returns the
   * principal. Does NOT check whether the session is still active – that is the
   * `authenticateAccessToken` use case's job.
   */
  verifyAccessToken(token: string): Promise<VerifiedTokenPrincipal>;
}

/** Thrown by {@link TokenService.verifyAccessToken} for any invalid token. */
export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidTokenError';
  }
}
