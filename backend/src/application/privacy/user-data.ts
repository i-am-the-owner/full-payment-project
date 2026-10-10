import { ConflictError, NotFoundError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';

/** Everything held about one person, for a UK GDPR subject access request. */
export interface UserDataExport {
  readonly exportedAt: string;
  readonly user: Record<string, unknown>;
  readonly profile: Record<string, unknown>;
  readonly security: Record<string, unknown>;
  readonly sessions: readonly Record<string, unknown>[];
  readonly providerLinks: readonly Record<string, unknown>[];
  readonly recipients: readonly Record<string, unknown>[];
  readonly quotes: readonly Record<string, unknown>[];
  readonly transfers: readonly Record<string, unknown>[];
  readonly notifications: readonly Record<string, unknown>[];
  readonly auditEvents: readonly Record<string, unknown>[];
  /** What is deliberately left out, and why. */
  readonly notIncluded: readonly string[];
}

export interface ErasureReport {
  readonly userId: string;
  /** Rows removed outright. */
  readonly deleted: Readonly<Record<string, number>>;
  /** Rows kept because the law requires financial records to be kept. */
  readonly retained: Readonly<Record<string, number>>;
  /** Things SomPay cannot erase itself. */
  readonly notes: readonly string[];
}

export interface UserDataRepository {
  /** Finds a user by id or email. */
  findUser(identifier: string): Promise<{ id: string; email: string; status: string } | null>;
  /** Transfers that are not finished: money may still be moving or owed. */
  countUnfinishedTransfers(userId: string): Promise<number>;
  export(userId: string): Promise<Omit<UserDataExport, 'exportedAt'>>;
  /** Removes or anonymises everything that is not a retained financial record, in one transaction. */
  erase(
    userId: string,
    options: { scrubAuditIpAddresses: boolean },
  ): Promise<Omit<ErasureReport, 'userId'>>;
}

export interface UserDataService {
  export(identifier: string): Promise<UserDataExport>;
  erase(
    identifier: string,
    options: { confirmEmail: string; scrubAuditIpAddresses?: boolean },
  ): Promise<ErasureReport>;
}

/**
 * Subject access (export) and erasure for UK GDPR requests.
 *
 * Erasure removes what SomPay does not need to keep (profile, contact
 * details, credentials, sessions, provider tokens, recipients never used) and
 * anonymises the account. Transfer records, with the recipient summary they
 * refer to, are RETAINED: financial transaction records must be kept for five
 * years under the Money Laundering Regulations 2017. It refuses while any
 * transfer is unfinished, and must be confirmed by typing the account's email.
 */
export function createUserDataService(deps: {
  repository: UserDataRepository;
  auditLog: AuditLog;
  clock: () => Date;
}): UserDataService {
  const find = async (
    identifier: string,
  ): Promise<{ id: string; email: string; status: string }> => {
    const user = await deps.repository.findUser(identifier);
    if (!user) {
      throw new NotFoundError('There is no such user.');
    }
    return user;
  };

  return {
    async export(identifier) {
      const user = await find(identifier);
      const data = await deps.repository.export(user.id);
      await deps.auditLog.record({
        actorType: 'system',
        action: 'privacy.user_exported',
        entityType: 'user',
        entityId: user.id,
      });
      return { exportedAt: deps.clock().toISOString(), ...data };
    },

    async erase(identifier, options) {
      const user = await find(identifier);
      if (user.status === 'closed' && user.email.endsWith('@deleted.invalid')) {
        throw new ConflictError('That account has already been erased.');
      }
      if (options.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
        throw new ConflictError(
          'The confirmation does not match the account email. Nothing was changed.',
        );
      }
      const unfinished = await deps.repository.countUnfinishedTransfers(user.id);
      if (unfinished > 0) {
        throw new ConflictError(
          `${unfinished} transfer(s) are not finished. Wait for them to complete or be cancelled, then try again.`,
        );
      }
      const report = await deps.repository.erase(user.id, {
        scrubAuditIpAddresses: options.scrubAuditIpAddresses ?? false,
      });
      await deps.auditLog.record({
        actorType: 'system',
        action: 'privacy.user_erased',
        entityType: 'user',
        entityId: user.id,
        context: { deleted: report.deleted, retained: report.retained },
      });
      return { userId: user.id, ...report };
    },
  };
}
