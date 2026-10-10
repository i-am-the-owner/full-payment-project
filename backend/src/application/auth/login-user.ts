import { UnauthorizedError } from '../../shared/errors.ts';
import type { TwoFactor } from './two-factor.ts';
import type { IssuedTokens } from '../../domain/auth/session.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { SessionService } from './session-service.ts';
import type { AdminAccessStore } from '../admin/admin-access.ts';
import type { Role } from '../../domain/auth/principal.ts';
import type { UserAccountStore } from './user-account-store.ts';

// A real argon2id hash of a throwaway value. Verified against when the account
// does not exist so that response timing does not reveal whether an email is
// registered. Not a secret.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$h8D0RUJtsAlTNzT7p3o73g$fteUo8sbvISlBHQBwGx5o6dC/BR/Lpqcql2zE5kRQOE';

const GENERIC_FAILURE = 'Invalid email or password.';

export interface LoginUserInput {
  readonly email: string;
  readonly password: string;
  /** The 6-digit authenticator code, when the account uses two-step sign-in. */
  readonly totpCode?: string | undefined;
  /** A one-time recovery code, instead of the authenticator code. */
  readonly recoveryCode?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface LoginResult {
  readonly tokens: IssuedTokens;
  readonly user: { readonly id: string; readonly email: string; readonly emailVerified: boolean };
}

export interface LoginUserDeps {
  readonly userAccountStore: UserAccountStore;
  readonly passwordHasher: PasswordHasher;
  readonly sessionService: SessionService;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
  readonly accountLockThreshold: number;
  readonly accountLockMinutes: number;
  /** Optional second step. When absent, sign-in is password only. */
  readonly twoFactor?: Pick<TwoFactor, 'checkAtLogin'>;
  /**
   * Staff roles. They are put into the session only if two-step sign-in is on
   * (the code was checked just above); otherwise the person signs in as a
   * customer and must set up 2FA before the admin role takes effect.
   */
  readonly adminAccess?: AdminAccessStore;
}

export type LoginUser = (input: LoginUserInput) => Promise<LoginResult>;

/**
 * Authenticates an email + password.
 *
 * Every failure path returns the same generic 401 and performs a password
 * verification (against a dummy hash if needed) so that timing and error text
 * reveal neither whether the account exists nor whether it is locked. Failed
 * attempts increment a counter that locks the account past a threshold.
 */
export function createLoginUser(deps: LoginUserDeps): LoginUser {
  return async (input) => {
    const account = await deps.userAccountStore.findByEmail(input.email);
    const now = deps.clock();

    const lockedUntil = account?.lockedUntil ?? null;
    const isLocked = lockedUntil !== null && lockedUntil.getTime() > now.getTime();
    const hashToCheck = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await deps.passwordHasher.verify(hashToCheck, input.password);

    if (!account || !account.passwordHash) {
      await deps.auditLog.record({
        actorType: 'system',
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: 'unknown',
        context: { reason: 'unknown_account' },
        requestId: input.requestId,
        ipAddress: input.ipAddress,
      });
      throw new UnauthorizedError(GENERIC_FAILURE);
    }

    if (account.status !== 'active' || isLocked || !passwordMatches) {
      let reason: string = account.status !== 'active' ? 'inactive_account' : 'bad_password';
      let locked = isLocked;

      if (account.status === 'active' && !isLocked && !passwordMatches) {
        ({ locked } = await deps.userAccountStore.recordFailedLogin(account.id, {
          lockThreshold: deps.accountLockThreshold,
          lockDurationMinutes: deps.accountLockMinutes,
        }));
        if (locked) {
          reason = 'account_locked';
        }
      }

      await deps.auditLog.record({
        actorType: 'user',
        actorId: account.id,
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: account.id,
        context: { reason, locked },
        requestId: input.requestId,
        ipAddress: input.ipAddress,
      });
      throw new UnauthorizedError(GENERIC_FAILURE);
    }

    // Second step, when the customer has turned it on. A missing code is
    // reported as such (the password was right, so nothing is revealed that the
    // caller does not already know); a wrong code counts as a failed attempt.
    if (
      deps.twoFactor &&
      !(await deps.twoFactor.checkAtLogin(account.id, input.totpCode, input.recoveryCode))
    ) {
      const { locked } = await deps.userAccountStore.recordFailedLogin(account.id, {
        lockThreshold: deps.accountLockThreshold,
        lockDurationMinutes: deps.accountLockMinutes,
      });
      await deps.auditLog.record({
        actorType: 'user',
        actorId: account.id,
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: account.id,
        context: { reason: 'bad_totp_code', locked },
        requestId: input.requestId,
        ipAddress: input.ipAddress,
      });
      throw new UnauthorizedError(GENERIC_FAILURE);
    }

    await deps.userAccountStore.recordSuccessfulLogin(account.id, input.ipAddress);

    if (deps.passwordHasher.needsRehash(account.passwordHash)) {
      await deps.userAccountStore.setPassword(
        account.id,
        await deps.passwordHasher.hash(input.password),
      );
    }

    const roles: Role[] = ['customer'];
    if (deps.adminAccess) {
      const access = await deps.adminAccess.get(account.id);
      if (access.roles.length > 0 && access.twoFactorEnabled) {
        roles.push(...access.roles);
      } else if (access.roles.length > 0) {
        await deps.auditLog.record({
          actorType: 'system',
          action: 'auth.staff_role_withheld',
          entityType: 'user',
          entityId: account.id,
          context: { reason: 'two_factor_not_enabled' },
          requestId: input.requestId,
          ipAddress: input.ipAddress,
        });
      }
    }

    const tokens = await deps.sessionService.startSession({
      userId: account.id,
      roles,
      emailVerified: account.emailVerified,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    await deps.auditLog.record({
      actorType: 'user',
      actorId: account.id,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: account.id,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
    });

    return {
      tokens,
      user: { id: account.id, email: account.email, emailVerified: account.emailVerified },
    };
  };
}
