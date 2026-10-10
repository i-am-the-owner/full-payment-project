import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { RateLimitConfig } from '../../../config/app-config.ts';
import { RateLimitError } from '../../../shared/errors.ts';
import '../express-augmentation.ts';

// Limiters are numbered in the order they are built: with the same code every
// instance numbers them the same way, so a shared store gives each its own counter.
const sequence = new WeakMap<object, number>();

function build(config: RateLimitConfig, name: string, limit: number): RateLimitRequestHandler {
  const { windowMs } = config;
  const next = (sequence.get(config) ?? 0) + 1;
  sequence.set(config, next);
  const store = config.storeFactory?.(`${name}-${next}`);
  return rateLimit({
    ...(store ? { store, passOnStoreError: true } : {}),
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Trust-proxy handling is configured on the Express app itself, so disable
    // the library's own permissive-proxy validation warning.
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req, _res, next) => {
      req.log.warn('ratelimit.exceeded', { path: req.path });
      next(new RateLimitError());
    },
  });
}

/** Coarse per-client limit applied to the whole API surface. */
export function globalRateLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  return build(config, 'global', config.globalMax);
}

/**
 * Stricter limit for authentication-sensitive endpoints (login, token refresh,
 * password reset — added in later milestones — and admin routes).
 */
export function sensitiveRateLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  return build(config, 'sensitive', config.authMax);
}

/**
 * Provider webhooks come from a few provider addresses, so they get their own,
 * much larger budget: they must never be throttled along with customer traffic.
 */
export function webhookRateLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  return build(config, 'webhook', config.globalMax * 10);
}
