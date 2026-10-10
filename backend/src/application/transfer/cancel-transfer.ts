import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.ts';
import { PayoutError } from '../../domain/payout/errors.ts';
import type { Transfer } from '../../domain/transfer/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import { toPayoutTransferRef } from './mappers.ts';
import {
  InvalidTransferTransitionError,
  type CustomerLinkStore,
  type TransferRepository,
} from './ports.ts';

export type CancelTransfer = (userId: string, transferId: string) => Promise<Transfer>;

const CANCELLABLE = new Set(['DRAFT', 'AWAITING_FUNDS']);

/**
 * Cancels a transfer that has not been funded. If it was already handed to the
 * provider, the provider is asked to cancel first; if it refuses, so do we.
 */
export function createCancelTransfer(deps: {
  provider: PayoutProvider;
  customerLinkStore: CustomerLinkStore;
  transferRepository: TransferRepository;
  auditLog: AuditLog;
}): CancelTransfer {
  return async (userId, transferId) => {
    const transfer = await deps.transferRepository.findById(transferId);
    if (!transfer) {
      throw new NotFoundError('That transfer could not be found.');
    }
    if (transfer.userId !== userId) {
      throw new ForbiddenError('That transfer belongs to another account.');
    }
    if (!CANCELLABLE.has(transfer.status)) {
      throw new ConflictError('That transfer can no longer be cancelled.');
    }

    const providerTransfer = toPayoutTransferRef(transfer);
    if (providerTransfer) {
      const record = await deps.customerLinkStore.find(userId, deps.provider.name);
      if (transfer.provider !== deps.provider.name || !record) {
        throw new ConflictError('That transfer can no longer be cancelled.');
      }
      try {
        await deps.provider.cancelTransfer({ link: record.link, transfer: providerTransfer });
      } catch (error) {
        if (error instanceof PayoutError) {
          throw new ConflictError('That transfer can no longer be cancelled.');
        }
        throw error;
      }
    }

    let cancelled: Transfer;
    try {
      cancelled = await deps.transferRepository.applyLocalStatusChange(transfer.id, {
        status: 'CANCELLED',
        failureReason: 'cancelled_by_customer',
        actor: 'user',
      });
    } catch (error) {
      if (error instanceof InvalidTransferTransitionError) {
        throw new ConflictError('That transfer can no longer be cancelled.');
      }
      throw error;
    }

    await deps.auditLog.record({
      actorType: 'user',
      actorId: userId,
      action: 'transfer.cancelled',
      entityType: 'transfer',
      entityId: transfer.id,
      context: { previousStatus: transfer.status },
    });
    return cancelled;
  };
}
