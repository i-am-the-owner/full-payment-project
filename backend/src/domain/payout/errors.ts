/**
 * Typed failures of the payout layer. Provider adapters translate every
 * provider-specific failure into one of these; the rest of the app never sees a
 * raw HTTP status or a provider error body.
 */

export type PayoutErrorCode =
  | 'ROUTE_NOT_SUPPORTED'
  | 'QUOTE_EXPIRED'
  | 'VALIDATION_FAILED'
  | 'INSUFFICIENT_FUNDS'
  | 'SCA_REQUIRED'
  | 'CUSTOMER_NOT_VERIFIED'
  | 'NEEDS_RELINK'
  | 'PROVIDER_UNAVAILABLE'
  | 'DUPLICATE'
  | 'PROVIDER_REJECTED'
  | 'NOT_IMPLEMENTED'
  | 'NOT_SUPPORTED';

export interface PayoutFieldError {
  readonly field: string;
  readonly message: string;
}

export class PayoutError extends Error {
  readonly code: PayoutErrorCode;
  /** Whether sending the same request again could succeed. */
  readonly retryable: boolean;

  constructor(
    code: PayoutErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

/** The provider does not send between these currencies / to this country. */
export class RouteNotSupportedError extends PayoutError {
  constructor(message = 'That route is not supported.') {
    super('ROUTE_NOT_SUPPORTED', message);
  }
}

/** The quote is past its expiry, was already used, or its price changed. */
export class QuoteExpiredError extends PayoutError {
  constructor(message = 'That quote has expired. Please request a new one.') {
    super('QUOTE_EXPIRED', message);
  }
}

/** The provider rejected the submitted values. `fieldErrors` are safe to show. */
export class ValidationFailedError extends PayoutError {
  readonly fieldErrors: readonly PayoutFieldError[];
  constructor(fieldErrors: readonly PayoutFieldError[], message = 'Some details are not valid.') {
    super('VALIDATION_FAILED', message);
    this.fieldErrors = fieldErrors;
  }
}

export class InsufficientFundsError extends PayoutError {
  constructor(message = 'There are not enough funds to pay for this transfer.') {
    super('INSUFFICIENT_FUNDS', message);
  }
}

/** The provider needs strong customer authentication before it will proceed. */
export class ScaRequiredError extends PayoutError {
  constructor(message = 'The provider requires additional authentication.') {
    super('SCA_REQUIRED', message);
  }
}

/** The provider has not verified this customer (KYC), so they cannot send money. */
export class CustomerNotVerifiedError extends PayoutError {
  constructor(message = 'Your identity must be verified before you can send money.') {
    super('CUSTOMER_NOT_VERIFIED', message);
  }
}

/** The customer's connection to the provider is no longer valid. */
export class NeedsRelinkError extends PayoutError {
  constructor(message = 'Your payment account needs to be connected again.') {
    super('NEEDS_RELINK', message);
  }
}

/**
 * The provider could not be reached or did not give a usable answer.
 * Retryable. `outcomeUnknown` is true when the request may still have taken
 * effect (no response, a 5xx, an unreadable response) – a transfer must then be
 * left pending and reconciled, never marked failed.
 */
export class ProviderUnavailableError extends PayoutError {
  readonly outcomeUnknown: boolean;
  constructor(
    message = 'The payment provider is temporarily unavailable.',
    options: { outcomeUnknown?: boolean; cause?: unknown } = {},
  ) {
    super('PROVIDER_UNAVAILABLE', message, { retryable: true, cause: options.cause });
    this.outcomeUnknown = options.outcomeUnknown ?? true;
  }
}

/** The same idempotency key or quote was already used for something else. */
export class DuplicateError extends PayoutError {
  constructor(message = 'This request duplicates an earlier one.') {
    super('DUPLICATE', message);
  }
}

/** A definitive provider refusal that is not about field values. */
export class ProviderRejectedError extends PayoutError {
  constructor(message = 'The payment provider refused the request.') {
    super('PROVIDER_REJECTED', message);
  }
}

/** The provider itself has no such operation: it will never be available. */
export class NotSupportedError extends PayoutError {
  constructor(provider: string, operation: string, reason?: string) {
    super(
      'NOT_SUPPORTED',
      `${provider} does not support ${operation}${reason ? `: ${reason}` : '.'}`,
    );
  }
}

/** The selected provider does not implement this operation yet. */
export class NotImplementedError extends PayoutError {
  constructor(provider: string, operation: string) {
    super('NOT_IMPLEMENTED', `${provider} does not implement ${operation} yet.`);
  }
}
