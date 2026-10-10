import type { RequestHandler } from 'express';
import { EmailNotVerifiedError, UnauthorizedError } from '../../../shared/errors.ts';
import '../express-augmentation.ts';

/**
 * Requires the authenticated account to have a verified email address. Must run
 * after {@link authenticate}. Intended to gate sensitive operations (money
 * movement, added later) rather than basic app access.
 */
export function requireVerifiedEmail(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (!req.auth.emailVerified) {
      next(new EmailNotVerifiedError());
      return;
    }
    next();
  };
}
