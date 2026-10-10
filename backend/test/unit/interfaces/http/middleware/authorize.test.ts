import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../../../../src/interfaces/http/middleware/authorize.ts';
import { ForbiddenError, UnauthorizedError } from '../../../../../src/shared/errors.ts';
import type { AuthenticatedPrincipal } from '../../../../../src/domain/auth/principal.ts';
import { mockRequest, runMiddleware } from '../../../../support/http-mocks.ts';
import { principalFixture } from '../../../../support/auth-fixtures.ts';

function principal(roles: AuthenticatedPrincipal['roles']): AuthenticatedPrincipal {
  return principalFixture({ roles });
}

test('401 when there is no authenticated principal', async () => {
  const { error } = await runMiddleware(authorize('admin'), mockRequest());
  assert.ok(error instanceof UnauthorizedError);
});

test('passes when no specific role is required and the caller is authenticated', async () => {
  const req = mockRequest();
  req.auth = principal(['customer']);
  const { error } = await runMiddleware(authorize(), req);
  assert.equal(error, undefined);
});

test('403 when the principal lacks every allowed role', async () => {
  const req = mockRequest();
  req.auth = principal(['customer']);
  const { error } = await runMiddleware(authorize('admin'), req);
  assert.ok(error instanceof ForbiddenError);
});

test('passes when the principal holds one of the allowed roles', async () => {
  const req = mockRequest();
  req.auth = principal(['customer', 'admin']);
  const { error } = await runMiddleware(authorize('admin', 'support'), req);
  assert.equal(error, undefined);
});
