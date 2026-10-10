import type { RequestHandler } from 'express';
import { hasAnyRole, type Role } from '../../../domain/auth/principal.ts';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors.ts';
import '../express-augmentation.ts';

/**
 * Requires the authenticated principal to hold at least one of `allowedRoles`.
 * Must run after {@link authenticate}. With no roles listed it only asserts that
 * the caller is authenticated.
 */
export function authorize(...allowedRoles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }

    if (allowedRoles.length > 0 && !hasAnyRole(req.auth, allowedRoles)) {
      req.log.warn('auth.forbidden', {
        requiredRoles: allowedRoles,
        principalRoles: req.auth.roles,
      });
      next(new ForbiddenError());
      return;
    }

    next();
  };
}
