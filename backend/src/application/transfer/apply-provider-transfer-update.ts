import type { TransferStatus } from '../../domain/payout/transfer-status.ts';
import type { Transfer } from '../../domain/transfer/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import {
  InvalidTransferTransitionError,
  StaleProviderEventError,
  type ProviderStatusEvidence,
  type TransferRepository,
} from './ports.ts';

export type ProviderUpdateOutcome =
  | { applied: true; transfer: Transfer; from: TransferStatus; to: TransferStatus }
  | {
      applied: false;
      /** `unknown_transfer`, `no_change`, `out_of_order` or `invalid_transition`. */
      reason: string;
      transfer?: Transfer;
    };

export type ApplyProviderTransferUpdate = (
  evidence: ProviderStatusEvidence,
) => Promise<ProviderUpdateOutcome>;

/** Something to do once a provider status has been applied. It must not throw. */
export type OnProviderStatusApplied = (change: {
  transfer: Transfer;
  from: TransferStatus;
  to: TransferStatus;
  evidence: ProviderStatusEvidence;
}) => Promise<void>;

/**
 * The single path by which a provider-reported status reaches a transfer –
 * from a verified webhook, a provider lookup, or a provider API response.
 *
 * Statuses only move FORWARD. An event that is older than one already applied
 * (`out_of_order`), or a step the lifecycle does not allow
 * (`invalid_transition`), is not applied; it is still written to the transfer's
 * event history, flagged as not applied.
 *
 * It is also the only path that can correct a transfer out of FAILED (a
 * provider sometimes reports a late success). Callers must hold
 * {@link ProviderStatusEvidence}; the database independently refuses these
 * transitions without it, and every applied change is written to the audit log.
 */
export function createApplyProviderTransferUpdate(deps: {
  transferRepository: TransferRepository;
  auditLog: AuditLog;
  onApplied?: OnProviderStatusApplied | undefined;
}): ApplyProviderTransferUpdate {
  return async (evidence) => {
    const transfer = await deps.transferRepository.findByProviderTransferId(
      evidence.provider,
      evidence.providerTransferId,
    );
    if (!transfer) {
      return { applied: false, reason: 'unknown_transfer' };
    }
    const from = transfer.status;
    if (evidence.status === from) {
      return { applied: false, reason: 'no_change', transfer };
    }

    const ignore = async (reason: string): Promise<ProviderUpdateOutcome> => {
      await deps.transferRepository.recordIgnoredEvent(transfer.id, evidence, reason);
      return { applied: false, reason, transfer };
    };

    let updated: Transfer;
    try {
      updated = await deps.transferRepository.applyProviderStatus(transfer.id, evidence);
    } catch (error) {
      if (error instanceof StaleProviderEventError) {
        return ignore('out_of_order');
      }
      if (error instanceof InvalidTransferTransitionError) {
        return ignore('invalid_transition');
      }
      throw error;
    }

    await deps.auditLog.record({
      actorType: 'provider',
      action:
        from === 'FAILED' ? 'transfer.status_corrected_by_provider' : 'transfer.status_changed',
      entityType: 'transfer',
      entityId: transfer.id,
      context: {
        from,
        to: evidence.status,
        provider: evidence.provider,
        providerStatus: evidence.providerStatus,
        source: evidence.source,
      },
    });

    // The status change is already saved: a failure here must not undo it.
    try {
      await deps.onApplied?.({ transfer: updated, from, to: evidence.status, evidence });
    } catch {
      // The hook reports its own failures.
    }

    return { applied: true, transfer: updated, from, to: evidence.status };
  };
}
