import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../../../../src/interfaces/http/middleware/error-handler.ts';
import { ValidationError } from '../../../../../src/shared/errors.ts';
import { createLogger } from '../../../../../src/shared/logger.ts';
import { mockRequest, mockResponse, type MockResponse } from '../../../../support/http-mocks.ts';
import type { ErrorEnvelope } from '../../../../../src/interfaces/http/response.ts';

function handle(err: unknown, logLines: string[] = []): MockResponse {
  const req = mockRequest({
    id: 'req-eh',
    log: createLogger({ level: 'debug', write: (_l, line) => logLines.push(line) }),
  });
  const response = mockResponse(req);
  errorHandler(err, req, response.res, () => undefined);
  return response;
}

test('renders an AppError as an error envelope with its status and code', () => {
  const response = handle(new ValidationError('nope', [{ field: 'body.x', message: 'Required' }]));

  assert.equal(response.statusCode, 400);
  const body = response.body as ErrorEnvelope;
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.message, 'nope');
  assert.equal(body.error.requestId, 'req-eh');
  assert.deepEqual(body.error.fieldErrors, [{ field: 'body.x', message: 'Required' }]);
});

test('maps a body-parser "too large" error to 413', () => {
  const err = Object.assign(new Error('request entity too large'), {
    type: 'entity.too.large',
    status: 413,
  });
  const response = handle(err);

  assert.equal(response.statusCode, 413);
  assert.equal((response.body as ErrorEnvelope).error.code, 'PAYLOAD_TOO_LARGE');
});

test('maps invalid JSON to 400 VALIDATION_ERROR', () => {
  const err = Object.assign(new SyntaxError('Unexpected token'), {
    type: 'entity.parse.failed',
    status: 400,
  });
  assert.equal((handle(err).body as ErrorEnvelope).error.code, 'VALIDATION_ERROR');
});

test('an unknown error becomes a generic 500 and is logged, leaking nothing', () => {
  const lines: string[] = [];
  const response = handle(new Error('connect ECONNREFUSED 10.0.0.5:5432 secret-detail'), lines);

  assert.equal(response.statusCode, 500);
  const body = response.body as ErrorEnvelope;
  assert.equal(body.error.code, 'INTERNAL');
  assert.equal(body.error.message, 'An unexpected error occurred. Please try again later.');
  assert.doesNotMatch(JSON.stringify(body), /ECONNREFUSED|secret-detail/);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /request\.unhandled_error/);
});
