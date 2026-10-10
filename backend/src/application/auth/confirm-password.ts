import { UnauthorizedError } from '../../shared/errors.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { UserAccountStore } from './user-account-store.ts';

/**
 * Re-checks the signed-in customer's password before a sensitive change (such
 * as setting up two-step sign-in), so a stolen access token alone is not enough.
 */
export type ConfirmPassword = (userId: string, password: string) => Promise<void>;

export function createConfirmPassword(deps: {
  userAccountStore: UserAccountStore;
  passwordHasher: PasswordHasher;
}): ConfirmPassword {
  return async (userId, password) => {
    const account = await deps.userAccountStore.findById(userId);
    const ok = account?.passwordHash
      ? await deps.passwordHasher.verify(account.passwordHash, password)
      : false;
    if (!account || !ok) {
      throw new UnauthorizedError('That password is not right.');
    }
  };
}
