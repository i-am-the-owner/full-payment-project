/**
 * SomPay's normalised view of failures from the Wise Platform API.
 *
 * The rest of the codebase catches these, never a raw HTTP status or a Wise
 * error body. `code` is a stable SomPay identifier; `providerCode` is Wise's
 * own error code when it gave one.
 */

export type WiseErrorCode =
  | 'wise_validation'
  | 'wise_auth'
  | 'wise_forbidden'
  | 'wise_not_found'
  | 'wise_conflict'
  | 'wise_rate_limited'
  | 'wise_unavailable'
  | 'wise_timeout'
  | 'wise_sca_required'
  | 'wise_relink_required'
  | 'wise_unexpected';

export interface WiseErrorDetail {
  readonly code: string;
  readonly message: string;
  /** The request field Wise complained about, when it says. */
  readonly field?: string | undefined;
}

export class WiseError extends Error {
  readonly code: WiseErrorCode;
  readonly httpStatus: number | undefined;
  readonly providerCode: string | undefined;
  /** Field-level problems, safe to surface (no values echoed). */
  readonly details: readonly WiseErrorDetail[];
  /** Whether retrying the same request could succeed. */
  readonly retryable: boolean;

  constructor(
    code: WiseErrorCode,
    message: string,
    options: {
      httpStatus?: number | undefined;
      providerCode?: string | undefined;
      details?: readonly WiseErrorDetail[];
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.providerCode = options.providerCode;
    this.details = options.details ?? [];
    this.retryable = options.retryable ?? false;
  }
}

export class WiseTimeoutError extends WiseError {
  constructor(message = 'The Wise API did not respond in time') {
    super('wise_timeout', message, { retryable: true });
  }
}

export class WiseScaRequiredError extends WiseError {
  /** The one-time token from the `x-2fa-approval` header. */
  readonly oneTimeToken: string;
  constructor(oneTimeToken: string, message = 'Wise requires strong customer authentication') {
    super('wise_sca_required', message, { httpStatus: 403, retryable: false });
    this.oneTimeToken = oneTimeToken;
  }
}
