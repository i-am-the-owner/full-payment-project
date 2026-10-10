import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Adapts an async handler to Express, forwarding any rejection to `next` so it
 * reaches the terminal error handler. Keeps route code free of boilerplate
 * try/catch while satisfying the no-floating-promises lint.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
