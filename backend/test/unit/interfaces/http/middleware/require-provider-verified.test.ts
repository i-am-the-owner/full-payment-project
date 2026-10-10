import test from 'node:test';
import assert from 'node:assert/strict';
import { requireProviderVerified } from '../../../../../src/interfaces/http/middleware/require-provider-verified.ts';
import { UnauthorizedError } from '../../../../../src/shared/errors.ts';
import { CustomerNotVerifiedError } from '../../../../../src/domain/payout/errors.ts';
import { mockRequest, runMiddleware } from '../../../../support/http-mocks.ts';
import { principalFixture } from '../../../../support/auth-fixtures.ts';

test('passes when the provider has verified the customer', async () => {
  const req = mockRequest();
  req.auth = principalFixture({ providerVerified: true });
  const { error } = await runMiddleware(requireProviderVerified(), req);
  assert.equal(error, undefined);
});

test('403 CUSTOMER_NOT_VERIFIED when the provider has not verified the customer', async () => {
  const req = mockRequest();
  req.auth = principalFixture({ emailVerified: true, providerVerified: false });
  const { error } = await runMiddleware(requireProviderVerified(), req);
  assert.ok(error instanceof CustomerNotVerifiedError);
  assert.equal(error.code, 'CUSTOMER_NOT_VERIFIED');
});

test('401 when there is no principal', async () => {
  const { error } = await runMiddleware(requireProviderVerified(), mockRequest());
  assert.ok(error instanceof UnauthorizedError);
});
