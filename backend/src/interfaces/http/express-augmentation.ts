import type { Logger } from '../../shared/logger.ts';
import type { AuthenticatedPrincipal } from '../../domain/auth/principal.ts';

/**
 * Per-request fields attached by middleware. Kept in one place so the
 * augmentation is easy to find and audit.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request, echoed back as `x-request-id`. */
      readonly id: string;
      /** Request-scoped logger with the request id already bound. */
      readonly log: Logger;
      /** Set by `authenticate` once a valid access token has been verified. */
      auth?: AuthenticatedPrincipal;
      /** Set by `validateRequest` with the parsed, typed request input. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
