import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../../../../../src/interfaces/http/middleware/authenticate.ts';
import { UnauthorizedError } from '../../../../../src/shared/errors.ts';
import { InvalidTokenError } from '../../../../../src/application/auth/token-service.ts';
import type { AccessTokenAuthenticator } from '../../../../../src/application/auth/authenticate-access-token.ts';
import { createLogger } from '../../../../../src/shared/logger.ts';
import { mockRequest, runMiddleware } from '../../../../support/http-mocks.ts';
import { principalFixture } from '../../../../support/auth-fixtures.ts';

const accepting: AccessTokenAuthenticator = (token) =>
  token === 'good'
    ? Promise.resolve(principalFixture())
    : Promise.reject(new InvalidTokenError('bad'));

test('passes a valid token through and attaches the principal', async () => {
  const { req, error } = await runMiddleware(
    authenticate(accepting),
    mockRequest({ headers: { authorization: 'Bearer good' } }),
  );

  assert.equal(error, undefined);
  assert.equal(req.auth?.userId, principalFixture().userId);
  assert.equal(req.auth?.sessionId, principalFixture().sessionId);
});

test('rejects a missing Authorization header with 401', async () => {
  const { error } = await runMiddleware(authenticate(accepting), mockRequest());
  assert.ok(error instanceof UnauthorizedError);
});

test('rejects a non-bearer scheme with 401', async () => {
  const { error } = await runMiddleware(
    authenticate(accepting),
    mockRequest({ headers: { authorization: 'Basic abc123' } }),
  );
  assert.ok(error instanceof UnauthorizedError);
});

test('maps a rejected token to a generic 401 without internal detail', async () => {
  const { error } = await runMiddleware(
    authenticate(accepting),
    mockRequest({ headers: { authorization: 'Bearer stale' } }),
  );
  assert.ok(error instanceof UnauthorizedError);
  assert.equal(error.message, 'The access token is invalid or has expired.');
});

test('never logs the raw token', async () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', write: (_level, line) => lines.push(line) });
  const failing: AccessTokenAuthenticator = () =>
    Promise.reject(new InvalidTokenError('the session is no longer active'));

  await runMiddleware(
    authenticate(failing),
    mockRequest({ headers: { authorization: 'Bearer super-secret-token-value' }, log }),
  );

  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /auth\.token_rejected/);
  assert.doesNotMatch(lines[0] ?? '', /super-secret-token-value/);
});
