import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../../domain/auth/principal.ts';
import { UnauthorizedError } from '../../shared/errors.ts';
import './express-augmentation.ts';

/**
 * Returns the authenticated principal, or throws. Use in handlers that run
 * after the `authenticate` middleware, to get a non-nullable principal without
 * a non-null assertion.
 */
export function requirePrincipal(req: Request): AuthenticatedPrincipal {
  if (!req.auth) {
    throw new UnauthorizedError();
  }
  return req.auth;
}
