/**
 * Application error hierarchy.
 *
 * `AppError` instances are "operational" errors: expected failure conditions
 * that map to a specific HTTP response and a stable, client-safe error `code`.
 * Anything that is not an `AppError` is treated as an unexpected fault and
 * reported as a generic 500 without leaking internal detail to the client.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ADMIN_2FA_REQUIRED'
  | 'TRANSFERS_PAUSED'
  | 'EMAIL_NOT_VERIFIED'
  | 'CUSTOMER_NOT_VERIFIED'
  | 'NEEDS_RELINK'
  | 'ROUTE_NOT_SUPPORTED'
  | 'QUOTE_EXPIRED'
  | 'INSUFFICIENT_FUNDS'
  | 'SCA_REQUIRED'
  | 'PROVIDER_REJECTED'
  | 'NOT_IMPLEMENTED'
  | 'NOT_SUPPORTED'
  | 'PROFILE_INCOMPLETE'
  | 'COUNTRY_NOT_SUPPORTED'
  | 'INVALID_ONBOARDING_STATE'
  | 'TOTP_REQUIRED'
  | 'TOTP_UNAVAILABLE'
  | 'LIMIT_EXCEEDED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

/** One field-level problem, safe to return to the client. */
export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fieldErrors: readonly FieldError[] | undefined;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    fieldErrors?: readonly FieldError[],
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.fieldErrors = fieldErrors;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is invalid.', fieldErrors?: readonly FieldError[]) {
    super('VALIDATION_ERROR', 400, message, fieldErrors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource.') {
    super('FORBIDDEN', 403, message);
  }
}

export class EmailNotVerifiedError extends AppError {
  constructor(message = 'Please verify your email address to continue.') {
    super('EMAIL_NOT_VERIFIED', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state.') {
    super('CONFLICT', 409, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please retry later.') {
    super('RATE_LIMITED', 429, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'The service is temporarily unavailable.',
    fieldErrors?: readonly FieldError[],
  ) {
    super('SERVICE_UNAVAILABLE', 503, message, fieldErrors);
  }
}
