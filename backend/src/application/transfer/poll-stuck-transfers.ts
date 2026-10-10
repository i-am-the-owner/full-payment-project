import { PayoutError } from '../../domain/payout/errors.ts';
import type { Logger } from '../../shared/logger.ts';
import { NotImplementedError, NotSupportedError } from '../../domain/payout/errors.ts';
import type { Transfer } from '../../domain/transfer/models.ts';
import type { AdminAlerts } from '../notifications/admin-alerts.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import type { ApplyProviderTransferUpdate } from './apply-provider-transfer-update.ts';
import type { CustomerLinkStore, TransferRepository } from './ports.ts';

export interface PollingConfig {
  /** A transfer with no status change for this long is "stuck". */
  readonly stuckAfterMs: number;
  /** Older transfers are no longer polled. */
  readonly maxAgeMs: number;
  /** A transfer polled more recently than this is left alone. */
  readonly minGapMs: number;
  /** At most this many transfers per run. */
  readonly batchSize: number;
  /** A DRAFT this old with no provider transfer at all is reported to an admin. */
  readonly unconfirmedAlertAfterMs: number;
}

export interface PollSummary {
  readonly checked: number;
  readonly changed: number;
  readonly adopted: number;
  readonly errors: number;
}

export const JOB_POLL_STUCK_TRANSFERS = 'poll_stuck_transfers';

/**
 * The safety net behind webhooks. Webhooks can be lost or delayed, so on a
 * schedule this looks at transfers that are not final and have not changed for
 * a while and asks the provider directly (`getTransfer`), applying any change
 * as provider evidence with source POLL.
 *
 * It also settles transfers whose create call never got an answer: it asks the
 * provider whether a transfer exists for our idempotency key and, if so,
 * adopts it. It never creates anything.
 */
export function createPollStuckTransfers(deps: {
  provider: PayoutProvider;
  customerLinkStore: CustomerLinkStore;
  transferRepository: TransferRepository;
  applyProviderTransferUpdate: ApplyProviderTransferUpdate;
  adminAlerts: AdminAlerts;
  logger: Logger;
  clock: () => Date;
  config: PollingConfig;
}): () => Promise<PollSummary> {
  const { config } = deps;
  const provider = deps.provider;

  return async () => {
    const now = deps.clock();
    const at = (msAgo: number): Date => new Date(now.getTime() - msAgo);
    let checked = 0;
    let changed = 0;
    let adopted = 0;
    let errors = 0;

    const tolerate = (transfer: Transfer, error: unknown): void => {
      errors += 1;
      deps.logger.warn('transfer.poll.failed', {
        transferId: transfer.id,
        code: error instanceof PayoutError ? error.code : 'ERROR',
      });
    };

    const stuck = await deps.transferRepository.listStuck({
      provider: provider.name,
      unchangedSince: at(config.stuckAfterMs),
      createdAfter: at(config.maxAgeMs),
      notPolledSince: at(config.minGapMs),
      limit: config.batchSize,
    });
    for (const transfer of stuck) {
      checked += 1;
      try {
        const record = await deps.customerLinkStore.find(transfer.userId, provider.name);
        if (record && transfer.providerTransferId) {
          const found = await provider.getTransfer({
            link: record.link,
            transferRef: transfer.providerTransferId,
          });
          if (found.status !== null) {
            const outcome = await deps.applyProviderTransferUpdate({
              source: 'provider_lookup',
              provider: provider.name,
              providerTransferId: transfer.providerTransferId,
              providerStatus: found.providerStatus,
              status: found.status,
              occurredAt: now,
            });
            if (outcome.applied) {
              changed += 1;
            }
          }
        }
      } catch (error) {
        tolerate(transfer, error);
      } finally {
        await deps.transferRepository.markPolled(transfer.id, now);
      }
    }

    const unsubmitted = await deps.transferRepository.listUnsubmitted({
      provider: provider.name,
      createdBefore: at(config.stuckAfterMs),
      createdAfter: at(config.maxAgeMs),
      notPolledSince: at(config.minGapMs),
      limit: config.batchSize,
    });
    for (const transfer of unsubmitted) {
      checked += 1;
      try {
        const record = await deps.customerLinkStore.find(transfer.userId, provider.name);
        if (!record) {
          continue;
        }
        const existing = await provider.findTransferByIdempotencyKey({
          link: record.link,
          idempotencyKey: transfer.id,
        });
        if (existing) {
          await deps.transferRepository.attachProviderTransfer(
            transfer.id,
            provider.name,
            existing.id,
          );
          adopted += 1;
          if (existing.status !== null) {
            const outcome = await deps.applyProviderTransferUpdate({
              source: 'provider_lookup',
              provider: provider.name,
              providerTransferId: existing.id,
              providerStatus: existing.providerStatus,
              status: existing.status,
              occurredAt: now,
            });
            if (outcome.applied) {
              changed += 1;
            }
          }
        } else if (transfer.createdAt.getTime() < now.getTime() - config.unconfirmedAlertAfterMs) {
          await deps.adminAlerts.raise({
            kind: 'TRANSFER_NOT_CONFIRMED',
            severity: 'medium',
            entityType: 'transfer',
            entityId: transfer.id,
            message:
              `Transfer ${transfer.reference} was never confirmed by the provider and the ` +
              `provider has no transfer for it. The customer can retry it from the app.`,
            context: { reference: transfer.reference, provider: provider.name },
          });
        }
      } catch (error) {
        // A provider with no lookup cannot settle this by polling.
        if (!(error instanceof NotSupportedError || error instanceof NotImplementedError)) {
          tolerate(transfer, error);
        }
      } finally {
        await deps.transferRepository.markPolled(transfer.id, now);
      }
    }

    deps.logger.info('transfer.poll.done', { checked, changed, adopted, errors });
    return { checked, changed, adopted, errors };
  };
}
