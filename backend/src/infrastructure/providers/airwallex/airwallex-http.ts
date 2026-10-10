import {
  DuplicateError,
  InsufficientFundsError,
  ProviderRejectedError,
  ProviderUnavailableError,
  QuoteExpiredError,
  RouteNotSupportedError,
  ValidationFailedError,
} from '../../../domain/payout/errors.ts';
import type { Logger } from '../../../shared/logger.ts';
import {
  fetchTransport,
  parseJson,
  ProviderHttpClient,
  type ProviderTransport,
} from '../provider-http-client.ts';

interface AirwallexErrorBody {
  code?: unknown;
  source?: unknown;
  message?: unknown;
}

const ROUTE_ERRORS = new Set([
  'transfer_currency_unsupported',
  'transfer_method_unsupported',
  'beneficiary_type_unsupported',
  'currency_pair_invalid',
  'SCHEMA_DEFINITION_NOT_FOUND',
]);
const DUPLICATE_ERRORS = new Set(['duplicate_request_id', 'request_id_duplicate']);
const QUOTE_ERRORS = new Set(['quote_expired', 'quote_id_invalid']);

/**
 * Translates an Airwallex error response into SomPay's typed payout errors.
 * Body shape per the Airwallex "Errors" reference: `{ code, source, message }`.
 * Only `code`, `source` and `message` are read; `details` may echo submitted
 * values and is never used.
 */
export function toAirwallexError(status: number, bodyText: string): Error {
  const body = (parseJson(bodyText) ?? {}) as AirwallexErrorBody;
  const code = typeof body.code === 'string' ? body.code : '';
  const source = typeof body.source === 'string' ? body.source : '';
  const message = typeof body.message === 'string' ? body.message : 'Invalid value';

  if (DUPLICATE_ERRORS.has(code)) return new DuplicateError();
  if (code === 'balance_insufficient') return new InsufficientFundsError();
  if (QUOTE_ERRORS.has(code)) return new QuoteExpiredError();
  if (ROUTE_ERRORS.has(code)) return new RouteNotSupportedError();

  // Refused before anything was processed.
  if (status === 401 || status === 429) {
    return new ProviderUnavailableError(undefined, { outcomeUnknown: false });
  }
  // "The request could not be completed due to a conflict with another
  // request" (e.g. request_pending): the first request may still succeed.
  if (status === 409 || status >= 500 || code === 'service_unavailable') {
    return new ProviderUnavailableError(undefined, { outcomeUnknown: true });
  }
  if (status === 400 || status === 422) {
    return new ValidationFailedError(source ? [{ field: source, message }] : [], message);
  }
  return new ProviderRejectedError();
}

export interface AirwallexHttpOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly getAuthToken: () => Promise<string>;
  readonly invalidateAuthToken: () => void;
  readonly logger: Logger;
  readonly transport?: ProviderTransport;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The shared provider HTTP client, configured for Airwallex. */
export function createAirwallexHttpClient(options: AirwallexHttpOptions): ProviderHttpClient {
  return new ProviderHttpClient({
    ...options,
    provider: 'airwallex',
    toError: (status, _headers, bodyText) => toAirwallexError(status, bodyText),
    toTransportError: (_kind, cause) =>
      new ProviderUnavailableError(undefined, { outcomeUnknown: true, cause }),
  });
}

export { fetchTransport };
