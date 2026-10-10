import { AppError, ValidationError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';

/** New transfers are paused by an admin. The message is written to be shown to customers. */
export class TransfersPausedError extends AppError {
  constructor(message: string) {
    super('TRANSFERS_PAUSED', 503, message);
  }
}

export interface PauseState {
  readonly paused: boolean;
  /** Shown to customers while paused. */
  readonly message: string;
  readonly updatedAt: Date | null;
}

export interface TransferPauseStore {
  get(): Promise<PauseState>;
  set(state: { paused: boolean; message: string }, adminUserId: string): Promise<void>;
}

export const DEFAULT_PAUSE_MESSAGE =
  'New transfers are paused for a short time. Transfers already in progress are not affected. Please try again later.';

export interface TransferPause {
  status(): Promise<PauseState>;
  /** Throws {@link TransfersPausedError} while paused. Call before anything that STARTS a transfer. */
  assertNewTransfersAllowed(): Promise<void>;
  /**
   * Pauses or resumes new transfers. Needs a current authenticator code from the
   * admin (on top of the admin session, which already needs 2FA). Audited.
   */
  setPaused(input: {
    adminUserId: string;
    paused: boolean;
    message?: string | undefined;
    code: string;
  }): Promise<PauseState>;
}

export function createTransferPause(deps: {
  store: TransferPauseStore;
  verifyAdminCode: (adminUserId: string, code: string) => Promise<boolean>;
  auditLog: AuditLog;
}): TransferPause {
  return {
    status: () => deps.store.get(),

    async assertNewTransfersAllowed() {
      const state = await deps.store.get();
      if (state.paused) {
        throw new TransfersPausedError(state.message);
      }
    },

    async setPaused({ adminUserId, paused, message, code }) {
      if (!(await deps.verifyAdminCode(adminUserId, code))) {
        throw new ValidationError('That code is not right.', [
          { field: 'body.code', message: 'Incorrect code' },
        ]);
      }
      const before = await deps.store.get();
      const text = message?.trim() || DEFAULT_PAUSE_MESSAGE;
      await deps.store.set({ paused, message: text }, adminUserId);
      await deps.auditLog.record({
        actorType: 'admin',
        actorId: adminUserId,
        action: paused ? 'admin.transfers.paused' : 'admin.transfers.resumed',
        entityType: 'system_setting',
        entityId: 'transfers_paused',
        context: { wasPaused: before.paused, message: paused ? text : undefined },
      });
      return deps.store.get();
    },
  };
}
