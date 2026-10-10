import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../../shared/errors.ts';

/**
 * Rejects plain-HTTP requests. Only enabled in production behind a trusted
 * proxy, where `req.secure` reflects the `X-Forwarded-Proto` header.
 */
export function requireHttps(enabled: boolean): RequestHandler {
  return (req, _res, next) => {
    if (enabled && !req.secure) {
      next(new ForbiddenError('HTTPS is required for this API.'));
      return;
    }
    next();
  };
}
