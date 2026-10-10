import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthenticateAccessToken } from '../../../../src/application/auth/authenticate-access-token.ts';
import { InvalidTokenError } from '../../../../src/application/auth/token-service.ts';
import { FakeSessionStore, FakeTokenService } from '../../../support/auth-fakes.ts';

async function setup() {
  const tokenService = new FakeTokenService();
  const sessionStore = new FakeSessionStore();
  const authenticate = createAuthenticateAccessToken({ tokenService, sessionStore });

  const session = await sessionStore.create({
    userId: 'user-1',
    roles: ['customer'],
    refreshTokenHash: 'hash',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const token = await tokenService.issueAccessToken({
    userId: 'user-1',
    roles: ['customer'],
    sessionId: session.id,
    emailVerified: false,
  });
  return { authenticate, sessionStore, token, sessionId: session.id };
}

test('returns the principal for a valid token with an active session', async () => {
  const { authenticate, token } = await setup();
  const principal = await authenticate(token);
  assert.equal(principal.userId, 'user-1');
  assert.deepEqual(principal.roles, ['customer']);
});

test('rejects a token whose session has been revoked', async () => {
  const { authenticate, sessionStore, token, sessionId } = await setup();
  await sessionStore.revoke(sessionId, 'logout');
  await assert.rejects(authenticate(token), InvalidTokenError);
});

test('rejects a token when the account is no longer active', async () => {
  const { authenticate, sessionStore, token } = await setup();
  sessionStore.userStatusById.set('user-1', 'closed');
  await assert.rejects(authenticate(token), InvalidTokenError);
});

test('surfaces email verification status from the database, not the token', async () => {
  const { authenticate, sessionStore, token } = await setup();
  sessionStore.emailVerifiedById.set('user-1', true);
  const principal = await authenticate(token);
  assert.equal(principal.emailVerified, true);
});
