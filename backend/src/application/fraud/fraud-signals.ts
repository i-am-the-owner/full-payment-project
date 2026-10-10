import type { Logger } from '../../shared/logger.ts';
import type { AdminAlerts } from '../notifications/admin-alerts.ts';
import type { RecipientRepository, TransferRepository } from '../transfer/ports.ts';

export interface FraudThresholds {
  /** Alert when a customer adds this many recipients within 24 hours. */
  readonly newRecipientsPerDay: number;
  /** Alert when this many of a customer's transfers fail within 24 hours. */
  readonly failedTransfersPerDay: number;
}

/** Cheap checks for patterns that often precede fraud. They alert a person; they never block. */
export interface FraudSignals {
  afterRecipientAdded(userId: string): Promise<void>;
  afterTransferFailed(userId: string): Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Raises an admin alert (one open alert per customer and kind, with a count of
 * repeats) when a customer's recent activity looks unusual. The alert carries
 * the customer's id and a count: no personal data. A failure here is logged and
 * never affects the customer's request.
 */
export function createFraudSignals(deps: {
  recipientRepository: Pick<RecipientRepository, 'countCreatedSince'>;
  transferRepository: Pick<TransferRepository, 'countFailedSince'>;
  adminAlerts: AdminAlerts;
  thresholds: FraudThresholds;
  clock: () => Date;
  logger: Logger;
}): FraudSignals {
  const since = (): Date => new Date(deps.clock().getTime() - DAY_MS);
  const guard = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      deps.logger.error('fraud.signal.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    afterRecipientAdded: (userId) =>
      guard(async () => {
        const count = await deps.recipientRepository.countCreatedSince(userId, since());
        if (count >= deps.thresholds.newRecipientsPerDay) {
          await deps.adminAlerts.raise({
            kind: 'MANY_NEW_RECIPIENTS',
            severity: 'medium',
            entityType: 'user',
            entityId: userId,
            message: `A customer added ${count} new recipients in the last 24 hours. Check that this is normal.`,
            context: { recipientsLast24h: count },
          });
        }
      }),
    afterTransferFailed: (userId) =>
      guard(async () => {
        const count = await deps.transferRepository.countFailedSince(userId, since());
        if (count >= deps.thresholds.failedTransfersPerDay) {
          await deps.adminAlerts.raise({
            kind: 'MANY_FAILED_TRANSFERS',
            severity: 'high',
            entityType: 'user',
            entityId: userId,
            message: `${count} of a customer's transfers failed in the last 24 hours. This can mean someone is testing stolen details.`,
            context: { failedTransfersLast24h: count },
          });
        }
      }),
  };
}
