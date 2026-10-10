import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestPasswordReset,
  createResetPassword,
} from '../../../../src/application/auth/password-reset.ts';
import { SessionService } from '../../../../src/application/auth/session-service.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import { hashSecretToken } from '../../../../src/shared/secret-token.ts';
import {
  FakeAuditLog,
  FakeAuthTokenStore,
  FakeMailer,
  FakePasswordHasher,
  FakeSessionStore,
  FakeTokenService,
  FakeUserAccountStore,
} from '../../../support/auth-fakes.ts';

function build() {
  const userAccountStore = new FakeUserAccountStore();
  const authTokenStore = new FakeAuthTokenStore();
  const mailer = new FakeMailer();
  const auditLog = new FakeAuditLog();
  const sessionStore = new FakeSessionStore();
  const passwordHasher = new FakePasswordHasher();
  const sessionService = new SessionService({
    tokenService: new FakeTokenService(),
    sessionStore,
    auditLog,
    clock: () => new Date(),
    refreshTokenTtlDays: 30,
    accessTokenTtlSeconds: 900,
  });

  const requestReset = createRequestPasswordReset({
    userAccountStore,
    authTokenStore,
    mailer,
    auditLog,
    clock: () => new Date(),
    passwordResetTtlMinutes: 60,
    publicAppUrl: 'https://app.almapay.test',
  });
  const resetPassword = createResetPassword({
    userAccountStore,
    authTokenStore,
    passwordHasher,
    sessionService,
    mailer,
    auditLog,
    passwordMinLength: 12,
  });
  return {
    requestReset,
    resetPassword,
    userAccountStore,
    authTokenStore,
    mailer,
    sessionStore,
    sessionService,
  };
}

test('forgot-password never throws for an unknown email and sends nothing', async () => {
  const { requestReset, mailer } = build();
  await requestReset({ email: 'nobody@example.test' });
  assert.equal(mailer.sent.length, 0);
});

test('forgot-password issues one reset token and emails it for a known account', async () => {
  const { requestReset, userAccountStore, authTokenStore, mailer } = build();
  userAccountStore.seed({ email: 'user@example.test' });

  await requestReset({ email: 'user@example.test' });

  assert.equal(authTokenStore.tokens.filter((t) => t.purpose === 'password_reset').length, 1);
  assert.equal(mailer.sent.at(-1)?.template, 'password_reset');
});

test('reset consumes the token, sets the new password and revokes all sessions', async () => {
  const {
    requestReset,
    resetPassword,
    userAccountStore,
    authTokenStore,
    mailer,
    sessionService,
    sessionStore,
  } = build();
  const account = userAccountStore.seed({ email: 'user@example.test', passwordHash: 'hashed:old' });
  await sessionService.startSession({
    userId: account.id,
    roles: ['customer'],
    emailVerified: true,
  });

  await requestReset({ email: 'user@example.test' });
  const url = mailer.lastUrl();
  const rawToken = new URL(url ?? '').searchParams.get('token') ?? '';

  await resetPassword({ token: rawToken, newPassword: 'a brand new strong passphrase' });

  assert.equal(
    userAccountStore.accounts.get(account.id)?.passwordHash,
    'hashed:a brand new strong passphrase',
  );
  assert.ok([...sessionStore.sessions.values()].every((s) => s.status === 'revoked'));
  assert.ok(authTokenStore.tokens.every((t) => t.consumed));
  assert.equal(mailer.sent.at(-1)?.template, 'password_changed');

  // The token cannot be replayed.
  await assert.rejects(
    resetPassword({ token: rawToken, newPassword: 'yet another strong passphrase' }),
    ValidationError,
  );
});

test('reset rejects a weak new password', async () => {
  const { resetPassword, authTokenStore } = build();
  authTokenStore.tokens.push({
    userId: 'u',
    purpose: 'password_reset',
    tokenHash: hashSecretToken('raw'),
    expiresAt: new Date(Date.now() + 60_000),
    consumed: false,
  });
  await assert.rejects(resetPassword({ token: 'raw', newPassword: 'weak' }), ValidationError);
});
