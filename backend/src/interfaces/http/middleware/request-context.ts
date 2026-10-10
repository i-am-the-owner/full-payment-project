import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Logger } from '../../../shared/logger.ts';
import '../express-augmentation.ts';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function resolveRequestId(req: Request): string {
  const header = req.get(REQUEST_ID_HEADER);
  return header && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

/**
 * Assigns a correlation id and a request-scoped logger, and emits one
 * structured line per completed request. Never logs the request body.
 */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const id = resolveRequestId(req);
    const log = logger.child({ requestId: id });

    Object.defineProperty(req, 'id', { value: id, enumerable: true });
    Object.defineProperty(req, 'log', { value: log, enumerable: true });
    res.setHeader(REQUEST_ID_HEADER, id);

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      log.info('request.completed', {
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });

    next();
  };
}
