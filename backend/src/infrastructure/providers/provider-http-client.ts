import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from '../../shared/logger.ts';

/** Injectable transport so tests can run without a network. Matches `fetch`. */
export type ProviderTransport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ProviderHttpClientOptions {
  /** Provider name, attached to every log line. */
  readonly provider: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Supplies (and can invalidate) the bearer token. */
  readonly getAuthToken: () => Promise<string>;
  readonly invalidateAuthToken: () => void;
  readonly logger: Logger;
  /** Maps a non-2xx response to the provider's typed error. */
  readonly toError: (
    status: number,
    headers: { get(name: string): string | null },
    bodyText: string,
  ) => Error;
  /** Maps "no response at all" (timeout or network failure) to a typed error. */
  readonly toTransportError: (kind: 'timeout' | 'network', cause: unknown) => Error;
  readonly transport?: ProviderTransport;
  /** Overridable for deterministic backoff in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ProviderHttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Record<string, string | undefined>;
  readonly body?: unknown;
  readonly extraHeaders?: Record<string, string>;
  /**
   * Whether it is safe to retry this request on a transient failure. GET is
   * always retryable; anything else is retried ONLY when the caller declares it
   * idempotent (e.g. a transfer creation carrying an idempotency key).
   */
  readonly retryable?: boolean;
  /** Correlates the log lines of one logical call. Generated when omitted. */
  readonly requestId?: string;
}

export interface ProviderHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly json: unknown;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 200;
const MAX_BACKOFF_MS = 2_000;

/** The default transport: the global `fetch`. */
export const fetchTransport: ProviderTransport = (url, init) => fetch(url, init);

/**
 * The one HTTP client every real provider adapter uses: bearer authentication,
 * JSON, a timeout on every attempt, bounded retry with backoff for safe calls
 * only, and structured logs that carry a request id and never a header, body,
 * token or query string.
 */
export class ProviderHttpClient {
  readonly #opts: ProviderHttpClientOptions;
  readonly #transport: ProviderTransport;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: ProviderHttpClientOptions) {
    this.#opts = opts;
    this.#transport = opts.transport ?? fetchTransport;
    this.#sleep = opts.sleep ?? ((ms) => delay(ms));
  }

  async send(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    const canRetry = request.method === 'GET' || request.retryable === true;
    const maxAttempts = canRetry ? this.#opts.maxRetries + 1 : 1;
    const requestId = request.requestId ?? randomUUID();
    let reauthAttempted = false;

    for (let attempt = 1; ; attempt += 1) {
      const startedAt = Date.now();
      let response: Awaited<ReturnType<ProviderTransport>>;
      try {
        response = await this.#attempt(request, requestId);
      } catch (transportError) {
        const durationMs = Date.now() - startedAt;
        this.#log('provider.request.transport_error', request, requestId, { attempt, durationMs });
        if (attempt < maxAttempts) {
          await this.#backoff(attempt);
          continue;
        }
        throw this.#opts.toTransportError(
          isAbortError(transportError) ? 'timeout' : 'network',
          transportError,
        );
      }

      const durationMs = Date.now() - startedAt;
      const bodyText = await response.text();
      this.#log('provider.request', request, requestId, {
        attempt,
        durationMs,
        status: response.status,
      });

      // Expired/rejected token: refresh once and retry immediately. A 401 means
      // the request was not processed, so this is safe for any method.
      if (response.status === 401 && !reauthAttempted) {
        reauthAttempted = true;
        this.#opts.invalidateAuthToken();
        continue;
      }

      if (RETRY_STATUSES.has(response.status) && attempt < maxAttempts) {
        await this.#backoff(attempt, response.headers.get('retry-after'));
        continue;
      }

      if (response.status >= 400) {
        throw this.#opts.toError(response.status, response.headers, bodyText);
      }

      return { status: response.status, headers: response.headers, json: parseJson(bodyText) };
    }
  }

  async #attempt(
    request: ProviderHttpRequest,
    requestId: string,
  ): Promise<Awaited<ReturnType<ProviderTransport>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#opts.timeoutMs);
    try {
      const token = await this.#opts.getAuthToken();
      return await this.#transport(this.#url(request), {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'x-request-id': requestId,
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...request.extraHeaders,
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  #url(request: ProviderHttpRequest): string {
    const url = new URL(`${this.#opts.baseUrl}${request.path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  async #backoff(attempt: number, retryAfterHeader?: string | null): Promise<void> {
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    const jitter = Math.random() * BASE_BACKOFF_MS;
    await this.#sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : exponential + jitter);
  }

  #log(
    message: string,
    request: ProviderHttpRequest,
    requestId: string,
    fields: Record<string, unknown>,
  ): void {
    // The path holds provider resource ids only (not secret, not personal).
    // Headers, the query string, the request body and the response body are
    // never logged.
    this.#opts.logger.info(message, {
      provider: this.#opts.provider,
      requestId,
      method: request.method,
      path: request.path,
      ...fields,
    });
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function parseJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
