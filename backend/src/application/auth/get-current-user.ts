import { ForbiddenError, UnauthorizedError } from '../../shared/errors.ts';
import type { UserDirectory, UserSummary } from './user-directory.ts';

export type GetCurrentUser = (userId: string) => Promise<UserSummary>;

/**
 * Resolves the authenticated user's own record.
 *
 * A token can outlive the account it was issued for, so the account is
 * re-checked on every call: an unknown account is treated as an invalid session
 * (401); a suspended or closed account is forbidden (403).
 */
export function createGetCurrentUser(directory: UserDirectory): GetCurrentUser {
  return async (userId) => {
    const user = await directory.findById(userId);
    if (!user) {
      throw new UnauthorizedError('The account for this token no longer exists.');
    }
    if (user.status !== 'active') {
      throw new ForbiddenError('This account is not active.');
    }
    return user;
  };
}
