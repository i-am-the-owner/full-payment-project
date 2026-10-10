import type { Logger } from '../../shared/logger.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { FraudSignals } from '../fraud/fraud-signals.ts';
import type { AdminAlerts } from '../notifications/admin-alerts.ts';
import { notificationKindFor } from '../notifications/transfer-messages.ts';
import type { OnProviderStatusApplied } from './apply-provider-transfer-update.ts';

export const JOB_NOTIFY_TRANSFER = 'notify_transfer';

/** Statuses in which the provider already holds the customer's money. */
const MONEY_WITH_PROVIDER = new Set(['PROCESSING', 'SENT', 'COMPLETED']);

/**
 * What follows a provider-confirmed status change: tell the customer, and tell
 * an admin when a transfer failed or was refunded after the provider had the
 * customer's money. Customer emails are queued, so a mail outage retries
 * instead of losing the message.
 */
export function createOnProviderStatusApplied(deps: {
  jobQueue: JobQueue;
  adminAlerts: AdminAlerts;
  fraudSignals?: FraudSignals | undefined;
  logger: Logger;
}): OnProviderStatusApplied {
  return async ({ transfer, from, to, evidence }) => {
    try {
      const kind = notificationKindFor(from, to);
      if (kind) {
        await deps.jobQueue.enqueue({
          type: JOB_NOTIFY_TRANSFER,
          payload: { transferId: transfer.id, kind },
          dedupeKey: `notify:${transfer.id}:${kind}`,
        });
      }

      if (to === 'FAILED') {
        await deps.fraudSignals?.afterTransferFailed(transfer.userId);
      }

      if (to === 'FAILED' && MONEY_WITH_PROVIDER.has(from)) {
        await deps.adminAlerts.raise({
          kind: 'PAYOUT_FAILED_AFTER_FUNDING',
          severity: 'high',
          entityType: 'transfer',
          entityId: transfer.id,
          message:
            `The payout for transfer ${transfer.reference} failed after the provider ` +
            `received the customer's money. The provider should refund the customer: ` +
            `check that the refund happens.`,
          context: {
            reference: transfer.reference,
            provider: evidence.provider,
            providerTransferId: evidence.providerTransferId,
            providerStatus: evidence.providerStatus,
            fromStatus: from,
          },
        });
      } else if (to === 'REFUNDED') {
        await deps.adminAlerts.raise({
          kind: 'TRANSFER_REFUNDED',
          severity: 'low',
          entityType: 'transfer',
          entityId: transfer.id,
          message: `Transfer ${transfer.reference} was refunded to the customer by the provider.`,
          context: {
            reference: transfer.reference,
            provider: evidence.provider,
            providerTransferId: evidence.providerTransferId,
            fromStatus: from,
          },
        });
      }
    } catch (error) {
      deps.logger.error('transfer.post_update.failed', {
        transferId: transfer.id,
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
