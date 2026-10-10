import type { RequestHandler } from 'express';
import type { AccessTokenAuthenticator } from '../../../application/auth/authenticate-access-token.ts';
import { InvalidTokenError } from '../../../application/auth/token-service.ts';
import { UnauthorizedError } from '../../../shared/errors.ts';
import { asyncHandler } from './async-handler.ts';
import '../express-augmentation.ts';

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies the `Authorization: Bearer <token>` access token (signature + active
 * session + active account) and attaches the principal to `req.auth`. The raw
 * token is never logged.
 */
export function authenticate(authenticator: AccessTokenAuthenticator): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.get('authorization');
    if (!header?.startsWith(BEARER_PREFIX)) {
      next(new UnauthorizedError('A bearer access token is required.'));
      return;
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    try {
      req.auth = await authenticator(token);
    } catch (error) {
      req.log.warn('auth.token_rejected', {
        reason: error instanceof InvalidTokenError ? error.message : 'verification failed',
      });
      next(new UnauthorizedError('The access token is invalid or has expired.'));
      return;
    }

    next();
  });
}

/**
 * Attaches `req.auth` if a valid token is present, but does not require one.
 * Used by endpoints that behave differently for anonymous callers (e.g. logout).
 */
export function optionalAuthenticate(authenticator: AccessTokenAuthenticator): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.get('authorization');
    if (header?.startsWith(BEARER_PREFIX)) {
      try {
        req.auth = await authenticator(header.slice(BEARER_PREFIX.length).trim());
      } catch {
        // Ignore – the route treats the caller as anonymous.
      }
    }
    next();
  });
}
