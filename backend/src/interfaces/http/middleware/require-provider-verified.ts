import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../../../shared/errors.ts';
import { CustomerNotVerifiedError, NeedsRelinkError } from '../../../domain/payout/errors.ts';
import '../express-augmentation.ts';

/**
 * Requires the customer to be verified by the licensed payout provider. Must
 * run after {@link authenticate}. Gates every endpoint that prices or moves
 * money. SomPay never sets this status itself – it mirrors provider data.
 */
export function requireProviderVerified(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (req.auth.needsRelink) {
      next(new NeedsRelinkError());
      return;
    }
    if (!req.auth.providerVerified) {
      next(new CustomerNotVerifiedError());
      return;
    }
    next();
  };
}
