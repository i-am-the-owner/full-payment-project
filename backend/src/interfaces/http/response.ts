import type { Response } from 'express';
import type { FieldError } from '../../shared/errors.ts';
import './express-augmentation.ts';

/**
 * The single response envelope used by every endpoint.
 *
 * Success: `{ "data": <payload>, "meta": { requestId, timestamp } }`
 * Error:   `{ "error": { code, message, requestId, timestamp, fieldErrors? } }`
 */

export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
}

export interface SuccessEnvelope<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly timestamp: string;
    readonly fieldErrors?: readonly FieldError[];
  };
}

function meta(res: Response): ResponseMeta {
  return { requestId: res.req.id, timestamp: new Date().toISOString() };
}

/** Writes a success envelope with the given HTTP status (default 200). */
export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: SuccessEnvelope<T> = { data, meta: meta(res) };
  res.status(status).json(body);
}

/** Builds an error envelope. Used by the terminal error handler. */
export function errorEnvelope(
  res: Response,
  code: string,
  message: string,
  fieldErrors?: readonly FieldError[],
): ErrorEnvelope {
  const { requestId, timestamp } = meta(res);
  return {
    error: {
      code,
      message,
      requestId,
      timestamp,
      ...(fieldErrors && fieldErrors.length > 0 ? { fieldErrors } : {}),
    },
  };
}
