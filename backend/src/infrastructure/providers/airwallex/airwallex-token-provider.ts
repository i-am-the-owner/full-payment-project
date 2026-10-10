import { ProviderUnavailableError } from '../../../domain/payout/errors.ts';
import type { ProviderTransport } from '../provider-http-client.ts';

// Refresh a little early so a token never expires mid-request.
const REFRESH_MARGIN_MS = 60_000;

export interface AirwallexTokenProviderOptions {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly apiKey: string;
  readonly transport: ProviderTransport;
  readonly timeoutMs: number;
  readonly now?: () => number;
}

/**
 * Exchanges the client id and API key for a short-lived access token
 * (`POST /api/v1/authentication/login`, headers `x-client-id` / `x-api-key`)
 * and reuses it until shortly before `expires_at`, as Airwallex asks. The token
 * lives in memory only and is never logged or stored.
 */
export class AirwallexTokenProvider {
  readonly #opts: AirwallexTokenProviderOptions;
  readonly #now: () => number;
  #cache: { token: string; expiresAtMs: number } | undefined;
  #inFlight: Promise<string> | undefined;

  constructor(options: AirwallexTokenProviderOptions) {
    this.#opts = options;
    this.#now = options.now ?? Date.now;
  }

  getToken(): Promise<string> {
    const cached = this.#cache;
    if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > this.#now()) {
      return Promise.resolve(cached.token);
    }
    // One login at a time, however many requests are waiting for it.
    this.#inFlight ??= this.#login().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  invalidate(): void {
    this.#cache = undefined;
  }

  async #login(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#opts.timeoutMs);
    let status: number;
    let text: string;
    try {
      const response = await this.#opts.transport(
        `${this.#opts.baseUrl}/api/v1/authentication/login`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-client-id': this.#opts.clientId,
            'x-api-key': this.#opts.apiKey,
          },
          signal: controller.signal,
        },
      );
      status = response.status;
      text = await response.text();
    } catch (cause) {
      throw new ProviderUnavailableError('Could not reach Airwallex to authenticate.', {
        outcomeUnknown: false,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    let body: { token?: unknown; expires_at?: unknown } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // Handled below: no token.
    }
    const expiresAtMs = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : NaN;
    if (status >= 400 || typeof body.token !== 'string' || Number.isNaN(expiresAtMs)) {
      // Never include the response body: it could echo credentials.
      throw new ProviderUnavailableError(`Airwallex authentication failed (HTTP ${status}).`, {
        outcomeUnknown: false,
      });
    }
    this.#cache = { token: body.token, expiresAtMs };
    return body.token;
  }
}
