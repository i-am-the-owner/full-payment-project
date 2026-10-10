import { evaluatePassword } from '../../domain/auth/password-policy.ts';
import { generateSecretToken } from '../../shared/secret-token.ts';
import { ValidationError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { AuthTokenStore } from './auth-token-store.ts';
import type { Mailer } from './mailer.ts';
import type { PasswordHasher } from './password-hasher.ts';
import type { UserAccountStore } from './user-account-store.ts';
import { buildVerificationLink } from './verification-link.ts';

export interface RegisterUserInput {
  readonly email: string;
  readonly password: string;
  readonly ipAddress?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface RegisterUserDeps {
  readonly userAccountStore: UserAccountStore;
  readonly passwordHasher: PasswordHasher;
  readonly authTokenStore: AuthTokenStore;
  readonly mailer: Mailer;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
  readonly emailVerificationTtlHours: number;
  readonly passwordMinLength: number;
  readonly publicAppUrl: string;
}

export type RegisterUser = (input: RegisterUserInput) => Promise<void>;

/**
 * Registers a new account.
 *
 * The response is identical whether or not the email already exists (no account
 * enumeration): the password is always hashed first to equalise timing, and a
 * duplicate address gets an "account already exists" email instead of a new
 * account. Registration never returns tokens – the user logs in afterwards.
 */
export function createRegisterUser(deps: RegisterUserDeps): RegisterUser {
  return async (input) => {
    const evaluation = evaluatePassword(input.password, { minLength: deps.passwordMinLength });
    if (!evaluation.ok) {
      throw new ValidationError(
        'The password does not meet the requirements.',
        evaluation.problems.map((message) => ({ field: 'body.password', message })),
      );
    }

    const passwordHash = await deps.passwordHasher.hash(input.password);
    const existing = await deps.userAccountStore.findByEmail(input.email);

    if (existing) {
      await deps.auditLog.record({
        actorType: 'system',
        action: 'auth.register.duplicate',
        entityType: 'user',
        entityId: existing.id,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
      });
      await deps.mailer.sendDuplicateRegistrationNotice(existing.email);
      return;
    }

    const { id } = await deps.userAccountStore.createAccount({
      email: input.email,
      passwordHash,
    });

    await issueVerificationEmail(deps, id, input.email, input.ipAddress);

    await deps.auditLog.record({
      actorType: 'user',
      actorId: id,
      action: 'auth.register.success',
      entityType: 'user',
      entityId: id,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
    });
  };
}

export async function issueVerificationEmail(
  deps: Pick<
    RegisterUserDeps,
    'authTokenStore' | 'mailer' | 'clock' | 'emailVerificationTtlHours' | 'publicAppUrl'
  >,
  userId: string,
  email: string,
  ipAddress: string | undefined,
): Promise<void> {
  await deps.authTokenStore.invalidateAllPending(userId, 'email_verification');
  const { raw, hash } = generateSecretToken();
  await deps.authTokenStore.issue({
    userId,
    purpose: 'email_verification',
    tokenHash: hash,
    expiresAt: new Date(deps.clock().getTime() + deps.emailVerificationTtlHours * 60 * 60 * 1000),
    ipAddress,
  });
  await deps.mailer.sendEmailVerification(
    email,
    buildVerificationLink(deps.publicAppUrl, 'verify-email', raw),
  );
}
