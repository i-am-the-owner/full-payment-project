import type { RequestHandler } from 'express';

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type, Idempotency-Key';
const PREFLIGHT_MAX_AGE_SECONDS = '600';

/**
 * Strict CORS. By default NO origin is allowed and no CORS header is sent, so a
 * browser on another site cannot read any response (the mobile app is not a
 * browser and is unaffected). Only origins listed in `CORS_ALLOWED_ORIGINS` -
 * exact matches, never `*`, and never with credentials/cookies (the API uses
 * bearer tokens) - are answered with CORS headers.
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin === undefined) {
      next();
      return;
    }
    // The answer depends on the Origin header, so caches must key on it.
    res.append('Vary', 'Origin');
    if (!allowed.has(origin)) {
      if (req.method === 'OPTIONS') {
        res.status(403).end();
        return;
      }
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
      res.status(204).end();
      return;
    }
    next();
  };
}
