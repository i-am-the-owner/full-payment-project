import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { SessionStore } from '../auth/session-store.ts';
import type { UserAccountRecord, UserAccountStore } from '../auth/user-account-store.ts';

export interface ManageUserAccounts {
  /**
   * Suspends an account. It takes effect on the user's very next request: every
   * request re-checks the account, so no token, old or new, works any more and
   * sending is blocked at once. All their sessions are revoked.
   */
  suspend(input: { adminUserId: string; userId: string; reason: string }): Promise<void>;
  /** Lifts a suspension. A closed account cannot be reinstated. */
  reinstate(input: { adminUserId: string; userId: string }): Promise<void>;
}

export function createManageUserAccounts(deps: {
  userAccountStore: UserAccountStore;
  sessionStore: SessionStore;
  auditLog: AuditLog;
}): ManageUserAccounts {
  const load = async (userId: string): Promise<UserAccountRecord> => {
    const account = await deps.userAccountStore.findById(userId);
    if (!account) {
      throw new NotFoundError('There is no such user.');
    }
    return account;
  };

  return {
    async suspend({ adminUserId, userId, reason }) {
      if (adminUserId === userId) {
        throw new ValidationError('You cannot suspend your own account.');
      }
      const account = await load(userId);
      if (account.status === 'closed') {
        throw new ConflictError('That account is closed.');
      }
      if (account.status !== 'suspended') {
        await deps.userAccountStore.setStatus(userId, 'suspended');
      }
      const revoked = await deps.sessionStore.revokeAllForUser(userId, 'admin_suspended');
      await deps.auditLog.record({
        actorType: 'admin',
        actorId: adminUserId,
        action: 'admin.user.suspended',
        entityType: 'user',
        entityId: userId,
        context: { reason, sessionsRevoked: revoked, previousStatus: account.status },
      });
    },

    async reinstate({ adminUserId, userId }) {
      const account = await load(userId);
      if (account.status === 'closed') {
        throw new ConflictError('A closed account cannot be reinstated.');
      }
      if (account.status === 'suspended') {
        await deps.userAccountStore.setStatus(userId, 'active');
      }
      await deps.auditLog.record({
        actorType: 'admin',
        actorId: adminUserId,
        action: 'admin.user.reinstated',
        entityType: 'user',
        entityId: userId,
        context: { previousStatus: account.status },
      });
    },
  };
}
