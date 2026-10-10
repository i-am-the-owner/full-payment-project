import { randomUUID } from 'node:crypto';
import type { Logger } from './logger.ts';

/**
 * Where unexpected errors are sent so someone is told. The reporter never
 * throws, never blocks a request, and sends only the error's type, message and
 * stack plus a request id: no request body, headers, user data or tokens.
 */
export interface ErrorReporter {
  capture(error: unknown, context?: { requestId?: string; where?: string }): void;
}

export const noopErrorReporter: ErrorReporter = { capture() {} };

export interface SentryReporterOptions {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** Most events sent per minute; the rest are dropped (an outage must not flood). */
  readonly maxPerMinute?: number;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Parses `https://<key>@<host>/<projectId>`. Null if it is not a usable DSN. */
export function parseDsn(dsn: string): { key: string; envelopeUrl: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, '');
    if (!url.username || !projectId || url.protocol !== 'https:') return null;
    return {
      key: url.username,
      envelopeUrl: `https://${url.host}/api/${projectId}/envelope/?sentry_version=7&sentry_key=${url.username}`,
    };
  } catch {
    return null;
  }
}

/**
 * Sends events to Sentry (or a compatible service) with the documented envelope
 * format over plain fetch, so there is no SDK to audit. NOT yet tested against a
 * live Sentry project.
 */
export function createSentryReporter(options: SentryReporterOptions): ErrorReporter {
  const parsed = parseDsn(options.dsn);
  if (!parsed) {
    options.logger.warn('error_reporter.invalid_dsn');
    return noopErrorReporter;
  }
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? ((): Date => new Date());
  const limit = options.maxPerMinute ?? 30;
  let windowStart = 0;
  let sent = 0;

  return {
    capture(error, context = {}) {
      const at = now();
      if (at.getTime() - windowStart > 60_000) {
        windowStart = at.getTime();
        sent = 0;
      }
      if (sent >= limit) return;
      sent += 1;

      const err = error instanceof Error ? error : new Error(String(error));
      const eventId = randomUUID().replaceAll('-', '');
      const event = {
        event_id: eventId,
        timestamp: at.getTime() / 1000,
        platform: 'node',
        level: 'error',
        environment: options.environment,
        release: options.release,
        server_name: 'almapay-backend',
        exception: {
          values: [{ type: err.name, value: err.message.slice(0, MAX_MESSAGE) }],
        },
        extra: { stack: (err.stack ?? '').slice(0, MAX_STACK), where: context.where },
        tags: context.requestId ? { request_id: context.requestId } : {},
      };
      const body = [
        JSON.stringify({ event_id: eventId, sent_at: at.toISOString() }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify(event),
      ].join('\n');

      void doFetch(parsed.envelopeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body,
        signal: AbortSignal.timeout(3000),
      }).catch((cause: unknown) => {
        options.logger.warn('error_reporter.send_failed', {
          error: cause instanceof Error ? cause.message : 'unknown',
        });
      });
    },
  };
}
