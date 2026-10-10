import type { RequestHandler } from 'express';
import type { HttpSecurityConfig } from '../../../config/app-config.ts';

/**
 * Security response headers for a JSON-only API.
 *
 * No CORS headers are sent: the API is consumed by the SomPay mobile app, not
 * by a browser, so cross-origin access stays disabled by default. A CORS
 * allowlist would be added deliberately if a web client is introduced.
 */
export function securityHeaders(config: HttpSecurityConfig): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    // API responses are per-request and must not be cached by shared caches.
    res.setHeader('Cache-Control', 'no-store');

    if (config.hstsEnabled) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };
}
