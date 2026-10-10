import type { WiseTransport } from './wise-http-client.ts';
import { WiseError } from './wise-errors.ts';

/** Supplies a bearer token for Wise API calls; can be told to discard a stale one. */
export interface WiseTokenProvider {
  getToken(): Promise<string>;
  invalidate(): void;
}

/** A fixed bearer token supplied by Wise onboarding. */
export class StaticWiseTokenProvider implements WiseTokenProvider {
  readonly #token: string;
  constructor(token: string) {
    this.#token = token;
  }
  getToken(): Promise<string> {
    return Promise.resolve(this.#token);
  }
  invalidate(): void {
    // A static token cannot be refreshed; a 401 will surface to the caller.
  }
}

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

const REFRESH_MARGIN_MS = 60_000;

/**
 * OAuth 2.0 client-credentials token provider.
 *
 * `POST {baseUrl}/oauth/token` with HTTP Basic (`client_id:client_secret`) and a
 * form body `grant_type=client_credentials`. The access token is cached until
 * shortly before it expires.
 */
export class ClientCredentialsWiseTokenProvider implements WiseTokenProvider {
  readonly #tokenUrl: string;
  readonly #basicAuth: string;
  readonly #transport: WiseTransport;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  #cache: CachedToken | undefined;
  #inflight: Promise<string> | undefined;

  constructor(options: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    transport: WiseTransport;
    timeoutMs: number;
    now?: () => number;
  }) {
    this.#tokenUrl = `${options.baseUrl.replace(/\/+$/, '')}/oauth/token`;
    this.#basicAuth = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64');
    this.#transport = options.transport;
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? (() => Date.now());
  }

  async getToken(): Promise<string> {
    const cached = this.#cache;
    if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > this.#now()) {
      return cached.value;
    }
    this.#inflight ??= this.#fetchToken().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  invalidate(): void {
    this.#cache = undefined;
  }

  async #fetchToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Awaited<ReturnType<WiseTransport>>;
    try {
      response = await this.#transport(this.#tokenUrl, {
        method: 'POST',
        headers: {
          authorization: `Basic ${this.#basicAuth}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });
    } catch (error) {
      throw new WiseError('wise_auth', 'Could not obtain a Wise access token', {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (response.status !== 200) {
      throw new WiseError('wise_auth', `Wise token endpoint returned ${response.status}`, {
        httpStatus: response.status,
      });
    }

    const parsed = JSON.parse(text) as OAuthTokenResponse;
    if (!parsed.access_token) {
      throw new WiseError('wise_auth', 'Wise token response had no access_token');
    }

    const ttlMs = (parsed.expires_in ?? 3600) * 1000;
    this.#cache = { value: parsed.access_token, expiresAtMs: this.#now() + ttlMs };
    return parsed.access_token;
  }
}
