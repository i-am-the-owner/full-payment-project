import { evaluatePassword } from '../../domain/auth/password-policy.ts';
import { generateSecretToken, hashSecretToken } from '../../shared/secret-token.ts';
import { ValidationError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { AuthTokenStore } from './auth-token-store.ts';
import type { Mailer } from './mailer.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { SessionService } from './session-service.ts';
import type { UserAccountStore } from './user-account-store.ts';
import { buildVerificationLink } from './verification-link.ts';

const GENERIC_INVALID = 'This password reset link is invalid or has expired.';

export interface RequestPasswordResetDeps {
  readonly userAccountStore: UserAccountStore;
  readonly authTokenStore: AuthTokenStore;
  readonly mailer: Mailer;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
  readonly passwordResetTtlMinutes: number;
  readonly publicAppUrl: string;
}

export type RequestPasswordReset = (input: {
  email: string;
  ipAddress?: string | undefined;
  requestId?: string | undefined;
}) => Promise<void>;

/** Always returns without error – the response must not reveal whether the email exists. */
export function createRequestPasswordReset(deps: RequestPasswordResetDeps): RequestPasswordReset {
  return async ({ email, ipAddress, requestId }) => {
    const account = await deps.userAccountStore.findByEmail(email);
    if (!account || account.status !== 'active') {
      return;
    }

    await deps.authTokenStore.invalidateAllPending(account.id, 'password_reset');
    const { raw, hash } = generateSecretToken();
    await deps.authTokenStore.issue({
      userId: account.id,
      purpose: 'password_reset',
      tokenHash: hash,
      expiresAt: new Date(deps.clock().getTime() + deps.passwordResetTtlMinutes * 60 * 1000),
      ipAddress,
    });
    await deps.mailer.sendPasswordReset(
      account.email,
      buildVerificationLink(deps.publicAppUrl, 'reset-password', raw),
    );
    await deps.auditLog.record({
      actorType: 'user',
      actorId: account.id,
      action: 'auth.password.reset_requested',
      entityType: 'user',
      entityId: account.id,
      requestId,
      ipAddress,
    });
  };
}

export interface ResetPasswordDeps {
  readonly userAccountStore: UserAccountStore;
  readonly authTokenStore: AuthTokenStore;
  readonly passwordHasher: PasswordHasher;
  readonly sessionService: SessionService;
  readonly mailer: Mailer;
  readonly auditLog: AuditLog;
  readonly passwordMinLength: number;
}

export type ResetPassword = (input: {
  token: string;
  newPassword: string;
  requestId?: string | undefined;
}) => Promise<void>;

/**
 * Completes a password reset: sets the new hash, revokes every session (forcing
 * re-login everywhere), invalidates other pending reset tokens, and notifies the
 * account owner.
 */
export function createResetPassword(deps: ResetPasswordDeps): ResetPassword {
  return async ({ token, newPassword, requestId }) => {
    const evaluation = evaluatePassword(newPassword, { minLength: deps.passwordMinLength });
    if (!evaluation.ok) {
      throw new ValidationError(
        'The password does not meet the requirements.',
        evaluation.problems.map((message) => ({ field: 'body.newPassword', message })),
      );
    }

    const consumed = await deps.authTokenStore.consume({
      purpose: 'password_reset',
      tokenHash: hashSecretToken(token),
    });
    if (!consumed) {
      throw new ValidationError(GENERIC_INVALID);
    }

    const account = await deps.userAccountStore.findById(consumed.userId);
    const passwordHash = await deps.passwordHasher.hash(newPassword);
    await deps.userAccountStore.setPassword(consumed.userId, passwordHash);
    await deps.authTokenStore.invalidateAllPending(consumed.userId, 'password_reset');
    await deps.sessionService.endAllSessions(consumed.userId, 'password_reset');

    if (account) {
      await deps.mailer.sendPasswordChangedNotice(account.email);
    }
    await deps.auditLog.record({
      actorType: 'user',
      actorId: consumed.userId,
      action: 'auth.password.reset_completed',
      entityType: 'user',
      entityId: consumed.userId,
      requestId,
    });
  };
}
