import type { ErrorRequestHandler } from 'express';
import { AppError, type ErrorCode } from '../../../shared/errors.ts';
import {
  PayoutError,
  ValidationFailedError,
  type PayoutErrorCode,
} from '../../../domain/payout/errors.ts';
import { noopErrorReporter, type ErrorReporter } from '../../../shared/error-reporter.ts';
import { errorEnvelope } from '../response.ts';
import '../express-augmentation.ts';

/** How each typed payout failure is presented to a client. */
const PAYOUT_HTTP: Record<PayoutErrorCode, { code: ErrorCode; status: number }> = {
  ROUTE_NOT_SUPPORTED: { code: 'ROUTE_NOT_SUPPORTED', status: 422 },
  QUOTE_EXPIRED: { code: 'QUOTE_EXPIRED', status: 409 },
  VALIDATION_FAILED: { code: 'VALIDATION_ERROR', status: 400 },
  INSUFFICIENT_FUNDS: { code: 'INSUFFICIENT_FUNDS', status: 409 },
  SCA_REQUIRED: { code: 'SCA_REQUIRED', status: 403 },
  CUSTOMER_NOT_VERIFIED: { code: 'CUSTOMER_NOT_VERIFIED', status: 403 },
  NEEDS_RELINK: { code: 'NEEDS_RELINK', status: 403 },
  PROVIDER_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', status: 503 },
  DUPLICATE: { code: 'CONFLICT', status: 409 },
  PROVIDER_REJECTED: { code: 'PROVIDER_REJECTED', status: 422 },
  NOT_IMPLEMENTED: { code: 'NOT_IMPLEMENTED', status: 501 },
  NOT_SUPPORTED: { code: 'NOT_SUPPORTED', status: 501 },
};

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

/** Maps errors thrown by `express.json()` to our error model. */
function fromBodyParserError(
  err: BodyParserError,
): { code: ErrorCode; status: number; message: string } | null {
  const status = err.status ?? err.statusCode;
  if (err.type === 'entity.too.large' || status === 413) {
    return { code: 'PAYLOAD_TOO_LARGE', status: 413, message: 'The request body is too large.' };
  }
  if (err.type === 'entity.parse.failed' || (status === 400 && err.type?.startsWith('entity'))) {
    return {
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'The request body is not valid JSON.',
    };
  }
  return null;
}

/**
 * Terminal error handler. Operational `AppError`s are returned with their
 * mapped status and stable code; body-parser errors are normalised; anything
 * else is logged and returned as a generic 500 so internal details and secrets
 * never reach the client.
 */
export function createErrorHandler(
  reporter: ErrorReporter = noopErrorReporter,
): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) {
      _next(err);
      return;
    }

    if (err instanceof AppError) {
      req.log.warn('request.failed', { code: err.code, status: err.httpStatus });
      res.status(err.httpStatus).json(errorEnvelope(res, err.code, err.message, err.fieldErrors));
      return;
    }

    if (err instanceof PayoutError) {
      const mapped = PAYOUT_HTTP[err.code];
      req.log.warn('request.failed', { code: mapped.code, status: mapped.status });
      // Payout error messages are written for customers and carry no provider detail.
      res
        .status(mapped.status)
        .json(
          errorEnvelope(
            res,
            mapped.code,
            err.message,
            err instanceof ValidationFailedError ? err.fieldErrors : undefined,
          ),
        );
      return;
    }

    const bodyParser = err instanceof Error ? fromBodyParserError(err) : null;
    if (bodyParser) {
      req.log.warn('request.failed', { code: bodyParser.code, status: bodyParser.status });
      res.status(bodyParser.status).json(errorEnvelope(res, bodyParser.code, bodyParser.message));
      return;
    }

    req.log.error('request.unhandled_error', {
      error: err instanceof Error ? err : { value: String(err) },
    });
    reporter.capture(err, { requestId: req.id, where: 'http' });
    res
      .status(500)
      .json(
        errorEnvelope(res, 'INTERNAL', 'An unexpected error occurred. Please try again later.'),
      );
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler();
