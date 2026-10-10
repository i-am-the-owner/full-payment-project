import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginUser } from '../../../../src/application/auth/login-user.ts';
import { SessionService } from '../../../../src/application/auth/session-service.ts';
import { UnauthorizedError } from '../../../../src/shared/errors.ts';
import {
  FakeAuditLog,
  FakePasswordHasher,
  FakeSessionStore,
  FakeTokenService,
  FakeUserAccountStore,
} from '../../../support/auth-fakes.ts';

function build() {
  const userAccountStore = new FakeUserAccountStore();
  const auditLog = new FakeAuditLog();
  const sessionStore = new FakeSessionStore();
  const sessionService = new SessionService({
    tokenService: new FakeTokenService(),
    sessionStore,
    auditLog,
    clock: () => new Date(),
    refreshTokenTtlDays: 30,
    accessTokenTtlSeconds: 900,
  });
  const login = createLoginUser({
    userAccountStore,
    passwordHasher: new FakePasswordHasher(),
    sessionService,
    auditLog,
    clock: () => new Date(),
    accountLockThreshold: 3,
    accountLockMinutes: 15,
  });
  return { login, userAccountStore, auditLog };
}

test('returns tokens for valid credentials and records the login', async () => {
  const { login, userAccountStore, auditLog } = build();
  const account = userAccountStore.seed({
    email: 'user@example.test',
    passwordHash: 'hashed:right password here',
    emailVerified: true,
  });

  const result = await login({ email: 'user@example.test', password: 'right password here' });

  assert.equal(result.user.id, account.id);
  assert.ok(result.tokens.accessToken);
  assert.ok(auditLog.actions().includes('auth.login.success'));
});

test('an unknown email fails generically', async () => {
  const { login } = build();
  await assert.rejects(
    login({ email: 'nobody@example.test', password: 'whatever password' }),
    (error: unknown) =>
      error instanceof UnauthorizedError && error.message === 'Invalid email or password.',
  );
});

test('a wrong password fails generically and increments the failure counter', async () => {
  const { login, userAccountStore } = build();
  const account = userAccountStore.seed({
    email: 'user@example.test',
    passwordHash: 'hashed:correct',
  });

  await assert.rejects(
    login({ email: 'user@example.test', password: 'incorrect' }),
    UnauthorizedError,
  );
  assert.equal(userAccountStore.accounts.get(account.id)?.failedLoginAttempts, 1);
});

test('the account locks after the threshold and stays locked for a correct password', async () => {
  const { login, userAccountStore } = build();
  userAccountStore.seed({ email: 'user@example.test', passwordHash: 'hashed:correct' });

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(
      login({ email: 'user@example.test', password: 'nope' }),
      UnauthorizedError,
    );
  }
  // Correct password, but the account is now locked → still generic 401.
  await assert.rejects(
    login({ email: 'user@example.test', password: 'correct' }),
    UnauthorizedError,
  );
});

test('a suspended account cannot log in', async () => {
  const { login, userAccountStore } = build();
  userAccountStore.seed({
    email: 'user@example.test',
    passwordHash: 'hashed:correct',
    status: 'suspended',
  });
  await assert.rejects(
    login({ email: 'user@example.test', password: 'correct' }),
    UnauthorizedError,
  );
});

function buildWithTwoFactor(check: (code: string | undefined) => Promise<boolean>) {
  const userAccountStore = new FakeUserAccountStore();
  const auditLog = new FakeAuditLog();
  const login = createLoginUser({
    userAccountStore,
    passwordHasher: new FakePasswordHasher(),
    sessionService: new SessionService({
      tokenService: new FakeTokenService(),
      sessionStore: new FakeSessionStore(),
      auditLog,
      clock: () => new Date(),
      refreshTokenTtlDays: 30,
      accessTokenTtlSeconds: 900,
    }),
    auditLog,
    clock: () => new Date(),
    accountLockThreshold: 3,
    accountLockMinutes: 15,
    twoFactor: { checkAtLogin: (_userId, code) => check(code) },
  });
  userAccountStore.seed({
    email: 'user@example.test',
    passwordHash: 'hashed:right password here',
    emailVerified: true,
  });
  return { login, auditLog };
}

test('with two-step sign-in, the right code signs in and a wrong one counts as a failed login', async () => {
  const { login, auditLog } = buildWithTwoFactor((code) => Promise.resolve(code === '123456'));
  const credentials = { email: 'user@example.test', password: 'right password here' };

  await assert.rejects(login({ ...credentials, totpCode: '000000' }), UnauthorizedError);
  assert.ok(auditLog.actions().includes('auth.login.failed'));

  const result = await login({ ...credentials, totpCode: '123456' });
  assert.ok(result.tokens.accessToken);
});

test('the second step is never reached with a wrong password', async () => {
  let asked = false;
  const { login } = buildWithTwoFactor(() => {
    asked = true;
    return Promise.resolve(true);
  });
  await assert.rejects(
    login({ email: 'user@example.test', password: 'the wrong password', totpCode: '123456' }),
    UnauthorizedError,
  );
  assert.equal(asked, false);
});
