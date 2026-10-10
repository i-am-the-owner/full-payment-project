import type { AuthenticatedPrincipal } from '../../domain/auth/principal.ts';
import { InvalidTokenError, type TokenService } from './token-service.ts';
import type { SessionStore } from './session-store.ts';

export type AccessTokenAuthenticator = (token: string) => Promise<AuthenticatedPrincipal>;

/**
 * Verifies an access token AND that its session is still active and the account
 * is still active. This makes logout / revocation effective immediately rather
 * than after the (short) access-token TTL, at the cost of one indexed lookup
 * per authenticated request.
 */
export function createAuthenticateAccessToken(deps: {
  tokenService: TokenService;
  sessionStore: SessionStore;
}): AccessTokenAuthenticator {
  return async (token) => {
    const claims = await deps.tokenService.verifyAccessToken(token);

    const check = await deps.sessionStore.findActiveWithUser(claims.sessionId);
    if (!check) {
      throw new InvalidTokenError('the session is no longer active');
    }
    if (check.userStatus !== 'active') {
      throw new InvalidTokenError('the account is not active');
    }

    return {
      userId: claims.userId,
      roles: claims.roles,
      tokenId: claims.tokenId,
      sessionId: claims.sessionId,
      emailVerified: check.emailVerified,
      providerVerified: check.providerVerified,
      needsRelink: check.needsRelink,
    };
  };
}
