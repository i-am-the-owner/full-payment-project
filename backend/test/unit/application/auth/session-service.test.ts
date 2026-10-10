import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidRefreshTokenError,
  SessionService,
} from '../../../../src/application/auth/session-service.ts';
import { hashSecretToken } from '../../../../src/shared/secret-token.ts';
import { FakeAuditLog, FakeSessionStore, FakeTokenService } from '../../../support/auth-fakes.ts';

function makeService(overrides: { clock?: () => Date } = {}) {
  const sessionStore = new FakeSessionStore();
  const auditLog = new FakeAuditLog();
  const service = new SessionService({
    tokenService: new FakeTokenService(),
    sessionStore,
    auditLog,
    clock: overrides.clock ?? (() => new Date()),
    refreshTokenTtlDays: 30,
    accessTokenTtlSeconds: 900,
  });
  return { service, sessionStore, auditLog };
}

test('startSession issues an access + refresh token and stores the hash', async () => {
  const { service, sessionStore } = makeService();
  const tokens = await service.startSession({
    userId: 'user-1',
    roles: ['customer'],
    emailVerified: true,
  });

  assert.ok(tokens.accessToken.length > 0);
  assert.ok(tokens.refreshToken.length > 0);
  const stored = [...sessionStore.sessions.values()][0];
  assert.equal(stored?.refreshTokenHash, hashSecretToken(tokens.refreshToken));
  assert.equal(stored?.status, 'active');
});

test('rotateSession rotates the token and marks the old session rotated', async () => {
  const { service, sessionStore } = makeService();
  const first = await service.startSession({
    userId: 'u',
    roles: ['customer'],
    emailVerified: false,
  });

  const second = await service.rotateSession({ refreshToken: first.refreshToken });

  assert.notEqual(second.refreshToken, first.refreshToken);
  const sessions = [...sessionStore.sessions.values()];
  assert.equal(sessions.find((s) => s.status === 'rotated')?.familyId, sessions[0]?.familyId);
  assert.equal(sessions.filter((s) => s.status === 'active').length, 1);
});

test('replaying a rotated refresh token revokes the whole family and audits it', async () => {
  const { service, sessionStore, auditLog } = makeService();
  const first = await service.startSession({
    userId: 'u',
    roles: ['customer'],
    emailVerified: false,
  });
  await service.rotateSession({ refreshToken: first.refreshToken });

  await assert.rejects(
    service.rotateSession({ refreshToken: first.refreshToken }),
    InvalidRefreshTokenError,
  );

  assert.ok([...sessionStore.sessions.values()].every((s) => s.status === 'revoked'));
  assert.ok(auditLog.actions().includes('auth.refresh.reuse_detected'));
});

test('an unknown refresh token is rejected', async () => {
  const { service } = makeService();
  await assert.rejects(service.rotateSession({ refreshToken: 'nope' }), InvalidRefreshTokenError);
});

test('an expired refresh token is rejected and revoked', async () => {
  let now = new Date('2026-01-01T00:00:00Z');
  const { service, sessionStore } = makeService({ clock: () => now });
  const first = await service.startSession({
    userId: 'u',
    roles: ['customer'],
    emailVerified: false,
  });

  now = new Date('2026-03-01T00:00:00Z'); // past the 30-day TTL

  await assert.rejects(
    service.rotateSession({ refreshToken: first.refreshToken }),
    InvalidRefreshTokenError,
  );
  assert.equal([...sessionStore.sessions.values()][0]?.status, 'revoked');
});

test('rotation is refused once the account is no longer active', async () => {
  const { service, sessionStore } = makeService();
  const first = await service.startSession({
    userId: 'u',
    roles: ['customer'],
    emailVerified: false,
  });
  sessionStore.userStatusById.set('u', 'suspended');

  await assert.rejects(
    service.rotateSession({ refreshToken: first.refreshToken }),
    InvalidRefreshTokenError,
  );
});

test('endAllSessions revokes every session for the user', async () => {
  const { service, sessionStore } = makeService();
  await service.startSession({ userId: 'u', roles: ['customer'], emailVerified: false });
  await service.startSession({ userId: 'u', roles: ['customer'], emailVerified: false });

  const revoked = await service.endAllSessions('u', 'password_reset');
  assert.equal(revoked, 2);
  assert.ok([...sessionStore.sessions.values()].every((s) => s.status === 'revoked'));
});
