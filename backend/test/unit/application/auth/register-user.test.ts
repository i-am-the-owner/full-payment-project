import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegisterUser } from '../../../../src/application/auth/register-user.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import {
  FakeAuditLog,
  FakeAuthTokenStore,
  FakeMailer,
  FakePasswordHasher,
  FakeUserAccountStore,
} from '../../../support/auth-fakes.ts';

function build() {
  const userAccountStore = new FakeUserAccountStore();
  const authTokenStore = new FakeAuthTokenStore();
  const mailer = new FakeMailer();
  const auditLog = new FakeAuditLog();
  const passwordHasher = new FakePasswordHasher();
  const register = createRegisterUser({
    userAccountStore,
    passwordHasher,
    authTokenStore,
    mailer,
    auditLog,
    clock: () => new Date(),
    emailVerificationTtlHours: 24,
    passwordMinLength: 12,
    publicAppUrl: 'https://app.almapay.test',
  });
  return { register, userAccountStore, authTokenStore, mailer, auditLog };
}

test('creates an unverified account and sends a verification email', async () => {
  const { register, userAccountStore, authTokenStore, mailer } = build();

  await register({ email: 'new@example.test', password: 'a strong enough passphrase' });

  const account = await userAccountStore.findByEmail('new@example.test');
  assert.ok(account);
  assert.equal(account.emailVerified, false);
  assert.equal(account.passwordHash, 'hashed:a strong enough passphrase');
  assert.equal(authTokenStore.tokens[0]?.purpose, 'email_verification');
  assert.equal(mailer.sent[0]?.template, 'email_verification');
});

test('a weak password is rejected before any account is created', async () => {
  const { register, userAccountStore } = build();
  await assert.rejects(register({ email: 'x@example.test', password: 'short' }), ValidationError);
  assert.equal(userAccountStore.accounts.size, 0);
});

test('a duplicate email creates nothing and sends the "already registered" email', async () => {
  const { register, userAccountStore, mailer } = build();
  userAccountStore.seed({ email: 'taken@example.test', passwordHash: 'hashed:existing' });

  await register({ email: 'taken@example.test', password: 'a different strong passphrase' });

  assert.equal(userAccountStore.accounts.size, 1);
  assert.equal(mailer.sent.at(-1)?.template, 'duplicate_registration');
});
