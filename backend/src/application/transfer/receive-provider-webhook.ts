import { createHash } from 'node:crypto';
import type { WebhookHeaders } from '../../domain/payout/models.ts';
import { redactPayload } from '../../shared/redact.ts';
import type { Logger } from '../../shared/logger.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import type { WebhookEventRepository } from './ports.ts';

export const JOB_PROCESS_WEBHOOK = 'process_webhook';

export type WebhookOutcome = 'invalid_signature' | 'ignored' | 'duplicate' | 'received';

export type ReceiveProviderWebhook = (delivery: {
  headers: WebhookHeaders;
  rawBody: Buffer;
  requestId?: string | undefined;
}) => Promise<WebhookOutcome>;

/**
 * Accepts one inbound provider webhook and returns quickly; the work happens in
 * a background job.
 *
 *   1. The signature is verified over the exact raw bytes BEFORE anything is
 *      parsed. A bad one is logged (no body contents) and recorded as an
 *      unverified delivery; nothing else happens.
 *   2. The event is recorded once per (provider, event id). A repeat is
 *      acknowledged and does nothing. A provider that sends no event id is
 *      deduplicated on the SHA-256 of the signed body (never on an unsigned
 *      header).
 *   3. A `process_webhook` job is queued (idempotently) and the caller is told
 *      "received". If queueing fails the request fails, so the provider retries.
 */
export function createReceiveProviderWebhook(deps: {
  provider: PayoutProvider;
  webhookEventRepository: WebhookEventRepository;
  jobQueue: JobQueue;
  auditLog: AuditLog;
  logger: Logger;
}): ReceiveProviderWebhook {
  const provider = deps.provider.name;

  return async ({ headers, rawBody, requestId }) => {
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');

    if (!deps.provider.verifyWebhook(headers, rawBody)) {
      deps.logger.warn('provider.webhook.invalid_signature', {
        provider,
        requestId,
        bodyBytes: rawBody.length,
      });
      await deps.webhookEventRepository
        .recordUnverified({ provider, bodySha256: bodyHash, bodyBytes: rawBody.length })
        .catch((error: unknown) => {
          // The rejection must not depend on the log table being writable.
          deps.logger.error('provider.webhook.record_failed', {
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return 'invalid_signature';
    }

    const event = deps.provider.parseWebhook(rawBody);
    // The event id sits inside the signed body, so it can be trusted.
    const providerEventId = event.eventId ?? bodyHash;
    const recorded = await deps.webhookEventRepository.recordVerified({
      provider,
      providerEventId,
      bodyHash,
      event,
      redactedPayload: redactPayload(event.raw),
    });

    if (!recorded.isNew && recorded.processed) {
      deps.logger.info('provider.webhook.duplicate', { provider, requestId });
      return 'duplicate';
    }

    if (event.type === 'unknown') {
      await deps.webhookEventRepository.markProcessed(recorded.id, 'ignored', 'unrecognised_event');
      deps.logger.info('provider.webhook.ignored', { provider, requestId });
      return 'ignored';
    }

    // Idempotent: a retry of a delivery that was recorded but not yet queued
    // (or not yet processed) joins the same job instead of adding another.
    await deps.jobQueue.enqueue({
      type: JOB_PROCESS_WEBHOOK,
      payload: { webhookEventId: recorded.id },
      dedupeKey: `webhook:${recorded.id}`,
    });

    if (!recorded.isNew) {
      deps.logger.info('provider.webhook.duplicate', { provider, requestId });
      return 'duplicate';
    }
    await deps.auditLog.record({
      actorType: 'provider',
      action: 'provider.webhook.received',
      entityType: 'provider_event',
      entityId: recorded.id,
      context: { provider, eventType: event.type, providerStatus: event.providerStatus },
      requestId,
    });
    return 'received';
  };
}
