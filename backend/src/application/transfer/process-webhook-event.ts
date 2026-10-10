import type { Logger } from '../../shared/logger.ts';
import type { JobContext } from '../jobs/job-runner.ts';
import type { AdminAlerts } from '../notifications/admin-alerts.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { ApplyProviderTransferUpdate } from './apply-provider-transfer-update.ts';
import type { CustomerLinkStore, StoredWebhookEvent, WebhookEventRepository } from './ports.ts';

/** Raised to make the job queue try again later; never reaches a client. */
class RetryLater extends Error {}

export interface ProcessWebhookEventDeps {
  readonly webhookEventRepository: WebhookEventRepository;
  readonly applyProviderTransferUpdate: ApplyProviderTransferUpdate;
  readonly customerLinkStore: CustomerLinkStore;
  readonly adminAlerts: AdminAlerts;
  readonly auditLog: AuditLog;
  readonly logger: Logger;
}

/**
 * The `process_webhook` job: applies one verified, recorded delivery.
 *
 * Transfer events go through the single provider-evidence path
 * (`applyProviderTransferUpdate`), so statuses only move forward; an event
 * that does not is recorded on the transfer's history and marked ignored.
 * Customer (KYC / account) events update `provider_links` the same way.
 *
 * An event for a transfer or customer we do not know yet is retried for a
 * while – a provider can announce a transfer before our own answer from the
 * create call has been saved – and then recorded as failed with an admin
 * alert. It never crashes the worker.
 */
export function createProcessWebhookEvent(
  deps: ProcessWebhookEventDeps,
): (payload: Readonly<Record<string, unknown>>, context: JobContext) => Promise<void> {
  const unknown = async (
    stored: StoredWebhookEvent,
    context: JobContext,
    what: 'transfer' | 'customer',
    ref: string,
  ): Promise<void> => {
    if (!context.isLastAttempt) {
      throw new RetryLater(`unknown_${what}`);
    }
    await deps.webhookEventRepository.markProcessed(stored.id, 'failed', `unknown_${what}`);
    await deps.adminAlerts.raise({
      kind: what === 'transfer' ? 'UNKNOWN_PROVIDER_TRANSFER' : 'UNKNOWN_PROVIDER_CUSTOMER',
      severity: 'medium',
      entityType: what === 'transfer' ? 'provider_transfer' : 'provider_customer',
      entityId: ref,
      message:
        `${stored.provider} told us about a ${what} we have no record of. ` +
        `Check it in the provider's dashboard.`,
      context: {
        provider: stored.provider,
        providerStatus: stored.event.providerStatus,
        webhookEventId: stored.id,
      },
    });
  };

  return async (payload, context) => {
    const id = payload.webhookEventId;
    if (typeof id !== 'string') {
      throw new Error('process_webhook needs a webhookEventId');
    }
    const stored = await deps.webhookEventRepository.findById(id);
    if (!stored || stored.processed) {
      return;
    }
    const { event } = stored;

    if (event.type === 'transfer.status_changed') {
      if (event.newStatus === null || !event.providerTransferId || !event.providerStatus) {
        await deps.webhookEventRepository.markProcessed(id, 'ignored', 'unmapped_status');
        return;
      }
      const outcome = await deps.applyProviderTransferUpdate({
        source: 'provider_webhook',
        provider: stored.provider,
        providerTransferId: event.providerTransferId,
        providerStatus: event.providerStatus,
        status: event.newStatus,
        occurredAt: event.occurredAt,
        eventPayload: event.raw,
      });
      if (outcome.applied) {
        await deps.webhookEventRepository.relateToTransfer(id, outcome.transfer.id);
        await deps.webhookEventRepository.markProcessed(id, 'processed');
        return;
      }
      if (outcome.reason === 'unknown_transfer') {
        await unknown(stored, context, 'transfer', event.providerTransferId);
        return;
      }
      if (outcome.transfer) {
        await deps.webhookEventRepository.relateToTransfer(id, outcome.transfer.id);
      }
      await deps.webhookEventRepository.markProcessed(id, 'ignored', outcome.reason);
      return;
    }

    if (event.type === 'customer.status_changed') {
      if (!event.providerCustomerRef || !event.newCustomerStatus) {
        await deps.webhookEventRepository.markProcessed(id, 'ignored', 'unmapped_status');
        return;
      }
      const result = await deps.customerLinkStore.recordProviderStatusByRef(
        stored.provider,
        event.providerCustomerRef,
        event.newCustomerStatus,
        event.occurredAt,
      );
      switch (result.outcome) {
        case 'applied':
          await deps.auditLog.record({
            actorType: 'provider',
            action: 'customer.verification_status_recorded',
            entityType: 'user',
            entityId: result.userId,
            context: {
              provider: stored.provider,
              reported: event.newCustomerStatus,
              previous: result.previous,
              source: 'webhook',
            },
          });
          await deps.webhookEventRepository.markProcessed(id, 'processed');
          return;
        case 'unknown_customer':
          await unknown(stored, context, 'customer', event.providerCustomerRef);
          return;
        case 'unchanged':
          await deps.webhookEventRepository.markProcessed(id, 'ignored', 'no_change');
          return;
        case 'stale':
          await deps.webhookEventRepository.markProcessed(id, 'ignored', 'out_of_order');
          return;
        case 'held_for_review':
          await deps.webhookEventRepository.markProcessed(id, 'ignored', 'held_for_review');
          return;
        case 'identity_not_checked':
          await deps.webhookEventRepository.markProcessed(id, 'ignored', 'identity_not_checked');
          return;
      }
    }

    await deps.webhookEventRepository.markProcessed(id, 'ignored', 'unrecognised_event');
  };
}
