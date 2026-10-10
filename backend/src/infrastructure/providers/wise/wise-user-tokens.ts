import { WiseError } from './wise-errors.ts';
import type { WiseTransport } from './wise-http-client.ts';

/**
 * UNTESTED AGAINST WISE: written from the documented OAuth flows
 * ("User access tokens", "Refresh tokens", `POST /oauth/token`) while SomPay
 * waits for partner credentials. Covered by tests with mocked HTTP only.
 */

/** Where a customer's long-lived refresh token is kept (encrypted at rest by the store). */
export interface RefreshTokenStore {
  read(customerRef: string): Promise<string | null>;
  save(customerRef: string, refreshToken: string): Promise<void>;
}

export interface UserTokens {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresInSeconds: number;
}

interface Cached {
  readonly value: string;
  readonly expiresAtMs: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * Wise says user access tokens last 12 hours and should be refreshed on a
 * 6-hour cadence; only ONE user access token is valid at a time, so a refresh
 * replaces the old one and must not happen twice at once for a customer.
 */
const REFRESH_WHEN_UNDER_MS = 6 * 60 * 60 * 1000;

export class WiseUserTokenManager {
  readonly #tokenUrl: string;
  readonly #basic: string;
  readonly #transport: WiseTransport;
  readonly #timeoutMs: number;
  readonly #store: RefreshTokenStore;
  readonly #now: () => number;
  readonly #cache = new Map<string, Cached>();
  readonly #inflight = new Map<string, Promise<string>>();

  constructor(options: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    transport: WiseTransport;
    timeoutMs: number;
    store: RefreshTokenStore;
    now?: () => number;
  }) {
    this.#tokenUrl = `${options.baseUrl.replace(/\/+$/, '')}/oauth/token`;
    this.#basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64');
    this.#transport = options.transport;
    this.#timeoutMs = options.timeoutMs;
    this.#store = options.store;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Exchanges the code Wise sent the customer's browser back with for tokens. */
  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<UserTokens> {
    const tokens = await this.#post(
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    );
    return tokens;
  }

  /** Keeps an access token obtained outside the manager (right after the code exchange). */
  remember(customerRef: string, tokens: UserTokens): void {
    this.#cache.set(customerRef, {
      value: tokens.accessToken,
      expiresAtMs: this.#now() + tokens.expiresInSeconds * 1000,
    });
  }

  /**
   * A valid access token for the customer. Refreshes (once, however many calls
   * ask at the same time) when the cached one is missing or past half its life.
   * A refresh token Wise no longer accepts means the customer must connect
   * again: that is a {@link WiseError} `wise_relink_required`.
   */
  accessTokenFor(customerRef: string): Promise<string> {
    const cached = this.#cache.get(customerRef);
    if (cached && cached.expiresAtMs - REFRESH_WHEN_UNDER_MS > this.#now()) {
      return Promise.resolve(cached.value);
    }
    let pending = this.#inflight.get(customerRef);
    if (!pending) {
      pending = this.#refresh(customerRef).finally(() => this.#inflight.delete(customerRef));
      this.#inflight.set(customerRef, pending);
    }
    return pending;
  }

  /** Forget the cached access token (Wise answered 401): the next call refreshes. */
  invalidate(customerRef: string): void {
    this.#cache.delete(customerRef);
  }

  async #refresh(customerRef: string): Promise<string> {
    const refreshToken = await this.#store.read(customerRef);
    if (!refreshToken) {
      throw new WiseError('wise_relink_required', 'No Wise connection is stored for this customer');
    }
    const tokens = await this.#post(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    );
    this.remember(customerRef, tokens);
    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      await this.#store.save(customerRef, tokens.refreshToken);
    }
    return tokens.accessToken;
  }

  async #post(body: URLSearchParams): Promise<UserTokens> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let status: number;
    let text: string;
    try {
      const response = await this.#transport(this.#tokenUrl, {
        method: 'POST',
        headers: {
          authorization: `Basic ${this.#basic}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      // The message never contains the request: it holds the customer's tokens.
      throw new WiseError('wise_unavailable', 'Could not reach the Wise token endpoint', {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    let parsed: TokenResponse = {};
    try {
      parsed = JSON.parse(text) as TokenResponse;
    } catch {
      // Handled below as an unreadable answer.
    }
    if (status === 400 && parsed.error === 'invalid_grant') {
      throw new WiseError('wise_relink_required', 'Wise no longer accepts this connection', {
        httpStatus: 400,
        providerCode: 'invalid_grant',
      });
    }
    if (status >= 500 || status === 429) {
      throw new WiseError('wise_unavailable', `Wise token endpoint returned ${status}`, {
        httpStatus: status,
        retryable: true,
      });
    }
    if (status !== 200 || !parsed.access_token) {
      throw new WiseError('wise_auth', `Wise token endpoint refused the request (${status})`, {
        httpStatus: status,
        providerCode: parsed.error,
      });
    }
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresInSeconds: parsed.expires_in ?? 43_200,
    };
  }
}
