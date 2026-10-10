import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetCurrentUser } from '../../../../src/application/auth/get-current-user.ts';
import { ForbiddenError, UnauthorizedError } from '../../../../src/shared/errors.ts';
import type {
  UserDirectory,
  UserSummary,
} from '../../../../src/application/auth/user-directory.ts';

function directoryReturning(user: UserSummary | null): UserDirectory {
  return { findById: () => Promise.resolve(user) };
}

const activeUser: UserSummary = {
  id: '44444444-4444-4444-4444-444444444444',
  email: 'a@example.test',
  status: 'active',
  emailVerified: true,
};

test('returns the account for an active user', async () => {
  const getCurrentUser = createGetCurrentUser(directoryReturning(activeUser));
  assert.deepEqual(await getCurrentUser(activeUser.id), activeUser);
});

test('401 when the account no longer exists', async () => {
  const getCurrentUser = createGetCurrentUser(directoryReturning(null));
  await assert.rejects(getCurrentUser(activeUser.id), UnauthorizedError);
});

test('403 when the account is suspended', async () => {
  const getCurrentUser = createGetCurrentUser(
    directoryReturning({ ...activeUser, status: 'suspended' }),
  );
  await assert.rejects(getCurrentUser(activeUser.id), ForbiddenError);
});
