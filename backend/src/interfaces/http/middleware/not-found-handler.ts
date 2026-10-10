import type { RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors.ts';

/** Converts unmatched routes into a `NotFoundError` for the error handler. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFoundError(`No route matches ${req.method} ${req.path}.`));
  };
}
