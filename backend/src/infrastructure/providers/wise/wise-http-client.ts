import type { Logger } from '../../../shared/logger.ts';
import {
  ProviderHttpClient,
  fetchTransport,
  parseJson,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderTransport,
} from '../provider-http-client.ts';
import { WiseError, WiseScaRequiredError, WiseTimeoutError } from './wise-errors.ts';

export type WiseTransport = ProviderTransport;
export type WiseHttpRequest = ProviderHttpRequest;
export type WiseHttpResponse = ProviderHttpResponse;
export { fetchTransport };

export interface WiseHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Supplies (and can invalidate) the bearer token. */
  readonly getAuthToken: () => Promise<string>;
  readonly invalidateAuthToken: () => void;
  readonly logger: Logger;
  readonly transport?: WiseTransport;
  /** Overridable for deterministic backoff in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * The shared {@link ProviderHttpClient} configured for Wise: every failure is
 * mapped to a `WiseError`. Knows nothing about specific Wise resources.
 */
export class WiseHttpClient extends ProviderHttpClient {
  constructor(opts: WiseHttpClientOptions) {
    super({
      ...opts,
      provider: 'wise',
      toError: toWiseError,
      toTransportError: (kind, cause) =>
        kind === 'timeout'
          ? new WiseTimeoutError()
          : new WiseError('wise_unavailable', 'Could not reach the Wise API', {
              retryable: true,
              cause,
            }),
    });
  }
}

interface WiseValidationBody {
  errors?: { code?: string; message?: string; path?: string }[];
}
interface WiseAuthBody {
  error?: string;
  error_description?: string;
}
interface WiseSystemBody {
  message?: string;
  error?: string;
}

export function toWiseError(
  status: number,
  headers: { get(name: string): string | null },
  bodyText: string,
): WiseError {
  const body = parseJson(bodyText);

  if (status === 403) {
    const oneTimeToken = headers.get('x-2fa-approval');
    if (oneTimeToken) {
      return new WiseScaRequiredError(oneTimeToken);
    }
    return new WiseError('wise_forbidden', 'Wise rejected the request (forbidden)', {
      httpStatus: 403,
    });
  }

  if (status === 400 || status === 422) {
    const details = ((body as WiseValidationBody | undefined)?.errors ?? []).map((e) => ({
      code: e.code ?? 'unknown',
      message: e.message ?? 'Invalid value',
      ...(typeof e.path === 'string' ? { field: e.path } : {}),
    }));
    return new WiseError('wise_validation', 'Wise rejected the request data', {
      httpStatus: status,
      details,
      providerCode: details[0]?.code,
    });
  }

  if (status === 401) {
    const auth = body as WiseAuthBody | undefined;
    return new WiseError('wise_auth', auth?.error_description ?? 'Wise authentication failed', {
      httpStatus: 401,
      providerCode: auth?.error,
    });
  }

  if (status === 404) {
    return new WiseError('wise_not_found', 'Wise resource not found', { httpStatus: 404 });
  }
  if (status === 409) {
    return new WiseError('wise_conflict', 'Wise reported a conflict', { httpStatus: 409 });
  }
  if (status === 429) {
    return new WiseError('wise_rate_limited', 'Wise rate limit exceeded', {
      httpStatus: 429,
      retryable: true,
    });
  }
  if (status >= 500) {
    const system = body as WiseSystemBody | undefined;
    return new WiseError('wise_unavailable', system?.message ?? 'Wise service error', {
      httpStatus: status,
      retryable: true,
    });
  }

  return new WiseError('wise_unexpected', `Unexpected Wise response (${status})`, {
    httpStatus: status,
  });
}
