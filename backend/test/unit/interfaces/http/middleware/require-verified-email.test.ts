import test from 'node:test';
import assert from 'node:assert/strict';
import { requireVerifiedEmail } from '../../../../../src/interfaces/http/middleware/require-verified-email.ts';
import { EmailNotVerifiedError, UnauthorizedError } from '../../../../../src/shared/errors.ts';
import { mockRequest, runMiddleware } from '../../../../support/http-mocks.ts';
import { principalFixture } from '../../../../support/auth-fixtures.ts';

test('passes when the email is verified', async () => {
  const req = mockRequest();
  req.auth = principalFixture({ emailVerified: true });
  const { error } = await runMiddleware(requireVerifiedEmail(), req);
  assert.equal(error, undefined);
});

test('403 EMAIL_NOT_VERIFIED when the email is not verified', async () => {
  const req = mockRequest();
  req.auth = principalFixture({ emailVerified: false });
  const { error } = await runMiddleware(requireVerifiedEmail(), req);
  assert.ok(error instanceof EmailNotVerifiedError);
  assert.equal(error.httpStatus, 403);
});

test('401 when there is no principal', async () => {
  const { error } = await runMiddleware(requireVerifiedEmail(), mockRequest());
  assert.ok(error instanceof UnauthorizedError);
});
