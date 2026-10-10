import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifyEmail } from '../../../../src/application/auth/verify-email.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import { hashSecretToken } from '../../../../src/shared/secret-token.ts';
import {
  FakeAuditLog,
  FakeAuthTokenStore,
  FakeUserAccountStore,
} from '../../../support/auth-fakes.ts';

function build() {
  const authTokenStore = new FakeAuthTokenStore();
  const userAccountStore = new FakeUserAccountStore();
  const auditLog = new FakeAuditLog();
  const verifyEmail = createVerifyEmail({ authTokenStore, userAccountStore, auditLog });
  return { verifyEmail, authTokenStore, userAccountStore, auditLog };
}

test('a valid token marks the account verified and is single-use', async () => {
  const { verifyEmail, authTokenStore, userAccountStore } = build();
  const account = userAccountStore.seed({ email: 'user@example.test' });
  authTokenStore.tokens.push({
    userId: account.id,
    purpose: 'email_verification',
    tokenHash: hashSecretToken('raw-token'),
    expiresAt: new Date(Date.now() + 60_000),
    consumed: false,
  });

  await verifyEmail('raw-token');
  assert.equal(userAccountStore.accounts.get(account.id)?.emailVerified, true);

  await assert.rejects(verifyEmail('raw-token'), ValidationError);
});

test('an unknown or expired token fails generically', async () => {
  const { verifyEmail } = build();
  await assert.rejects(verifyEmail('never-issued'), ValidationError);
});
