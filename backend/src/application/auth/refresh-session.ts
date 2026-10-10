import { UnauthorizedError } from '../../shared/errors.ts';
import type { IssuedTokens } from '../../domain/auth/session.ts';
import { InvalidRefreshTokenError, type SessionService } from './session-service.ts';

export type RefreshSession = (input: {
  refreshToken: string;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}) => Promise<IssuedTokens>;

export function createRefreshSession(sessionService: SessionService): RefreshSession {
  return async (input) => {
    try {
      return await sessionService.rotateSession(input);
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new UnauthorizedError('The refresh token is invalid or has expired.');
      }
      throw error;
    }
  };
}
