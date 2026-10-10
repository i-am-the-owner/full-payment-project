import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/shared/errors.ts';

test('each error carries a stable code and HTTP status', () => {
  assert.deepEqual(
    [
      new ValidationError().code,
      new UnauthorizedError().code,
      new ForbiddenError().code,
      new NotFoundError().code,
      new RateLimitError().code,
      new ServiceUnavailableError().code,
    ],
    [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
    ],
  );

  assert.deepEqual(
    [
      new ValidationError().httpStatus,
      new UnauthorizedError().httpStatus,
      new ForbiddenError().httpStatus,
      new NotFoundError().httpStatus,
      new RateLimitError().httpStatus,
      new ServiceUnavailableError().httpStatus,
    ],
    [400, 401, 403, 404, 429, 503],
  );
});

test('all are instances of AppError and Error', () => {
  const error = new NotFoundError();
  assert.ok(error instanceof AppError);
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'NotFoundError');
});

test('ValidationError carries field errors', () => {
  const error = new ValidationError('bad', [{ field: 'body.email', message: 'Required' }]);
  assert.deepEqual(error.fieldErrors, [{ field: 'body.email', message: 'Required' }]);
});
