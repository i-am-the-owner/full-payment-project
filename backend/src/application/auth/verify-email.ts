import { hashSecretToken } from '../../shared/secret-token.ts';
import { ValidationError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { AuthTokenStore } from './auth-token-store.ts';
import type { UserAccountStore } from './user-account-store.ts';
import { issueVerificationEmail, type RegisterUserDeps } from './register-user.ts';

const GENERIC_INVALID = 'This verification link is invalid or has expired.';

export interface VerifyEmailDeps {
  readonly authTokenStore: AuthTokenStore;
  readonly userAccountStore: UserAccountStore;
  readonly auditLog: AuditLog;
}

export type VerifyEmail = (token: string) => Promise<void>;

export function createVerifyEmail(deps: VerifyEmailDeps): VerifyEmail {
  return async (token) => {
    const result = await deps.authTokenStore.consume({
      purpose: 'email_verification',
      tokenHash: hashSecretToken(token),
    });
    if (!result) {
      throw new ValidationError(GENERIC_INVALID);
    }

    await deps.userAccountStore.markEmailVerified(result.userId);
    await deps.auditLog.record({
      actorType: 'user',
      actorId: result.userId,
      action: 'auth.email.verified',
      entityType: 'user',
      entityId: result.userId,
    });
  };
}

export type ResendEmailVerification = (input: {
  userId: string;
  email: string;
  emailVerified: boolean;
  ipAddress?: string | undefined;
}) => Promise<void>;

export function createResendEmailVerification(
  deps: Pick<
    RegisterUserDeps,
    'authTokenStore' | 'mailer' | 'clock' | 'emailVerificationTtlHours' | 'publicAppUrl'
  >,
): ResendEmailVerification {
  return async ({ userId, email, emailVerified, ipAddress }) => {
    if (emailVerified) {
      return;
    }
    await issueVerificationEmail(deps, userId, email, ipAddress);
  };
}
