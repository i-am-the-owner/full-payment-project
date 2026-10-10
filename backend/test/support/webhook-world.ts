import { createJobRunner } from '../../src/application/jobs/job-runner.ts';
import { createNotifyTransfer } from '../../src/application/notifications/notify-transfer.ts';
import { createApplyProviderTransferUpdate } from '../../src/application/transfer/apply-provider-transfer-update.ts';
import {
  createOnProviderStatusApplied,
  JOB_NOTIFY_TRANSFER,
} from '../../src/application/transfer/on-status-applied.ts';
import {
  createPollStuckTransfers,
  JOB_POLL_STUCK_TRANSFERS,
} from '../../src/application/transfer/poll-stuck-transfers.ts';
import { createProcessWebhookEvent } from '../../src/application/transfer/process-webhook-event.ts';
import {
  createReceiveProviderWebhook,
  JOB_PROCESS_WEBHOOK,
} from '../../src/application/transfer/receive-provider-webhook.ts';
import { createLogger } from '../../src/shared/logger.ts';
import { ANSWERS, quoteAndRecipient, useCases } from './send-money-steps.ts';
import { buildWorld, USER, type World } from './transfer-fakes.ts';

export const silentLogger = createLogger({ level: 'error', write: () => {} });

/** Everything needed to receive, queue, process, notify and poll, over one in-memory world. */
export function webhookSystem(world: World, options: { logLines?: string[] } = {}) {
  const logger = options.logLines
    ? createLogger({ level: 'debug', write: (_level, line) => options.logLines!.push(line) })
    : silentLogger;

  const applyProviderTransferUpdate = createApplyProviderTransferUpdate({
    transferRepository: world.transferRepository,
    auditLog: world.auditLog,
    onApplied: createOnProviderStatusApplied({
      jobQueue: world.jobQueue,
      adminAlerts: world.adminAlerts,
      logger,
    }),
  });
  const receive = createReceiveProviderWebhook({
    provider: world.provider,
    webhookEventRepository: world.webhookEventRepository,
    jobQueue: world.jobQueue,
    auditLog: world.auditLog,
    logger,
  });
  const pollStuckTransfers = createPollStuckTransfers({
    provider: world.provider,
    customerLinkStore: world.customerLinkStore,
    transferRepository: world.transferRepository,
    applyProviderTransferUpdate,
    adminAlerts: world.adminAlerts,
    logger,
    clock: world.clock,
    config: {
      stuckAfterMs: 30 * 60_000,
      maxAgeMs: 30 * 24 * 60 * 60_000,
      minGapMs: 10 * 60_000,
      batchSize: 100,
      unconfirmedAlertAfterMs: 60 * 60_000,
    },
  });
  const runner = createJobRunner({
    queue: world.jobQueue,
    adminAlerts: world.adminAlerts,
    logger,
    clock: world.clock,
    workerId: 'test-worker',
    backoffBaseMs: 1000,
    handlers: {
      [JOB_PROCESS_WEBHOOK]: createProcessWebhookEvent({
        webhookEventRepository: world.webhookEventRepository,
        applyProviderTransferUpdate,
        customerLinkStore: world.customerLinkStore,
        adminAlerts: world.adminAlerts,
        auditLog: world.auditLog,
        logger,
      }),
      [JOB_NOTIFY_TRANSFER]: createNotifyTransfer({
        transferRepository: world.transferRepository,
        recipientRepository: world.recipientRepository,
        currencyRegistry: world.currencyRegistry,
        notificationLog: world.notificationLog,
        mailer: world.mailer,
        findUserEmail: (userId) => Promise.resolve(userId === USER ? 'jane@example.test' : null),
        supportEmail: 'support@almapay.example',
        logger,
      }),
      [JOB_POLL_STUCK_TRANSFERS]: async () => {
        await pollStuckTransfers();
      },
    },
  });
  return { applyProviderTransferUpdate, receive, runner, pollStuckTransfers, logger };
}

/** A confirmed transfer (AWAITING_FUNDS at the mock provider) with the webhook system around it. */
export async function transferWithWebhooks(
  options: Parameters<typeof buildWorld>[0] = {},
  sourceAmountMinor = 10_000n,
) {
  const world = buildWorld(options);
  // Fills the currency registry, which the notification formatter reads.
  await world.currencyCatalogue.get();
  const { quote, recipient } = await quoteAndRecipient(world, sourceAmountMinor);
  const { transfer } = await useCases(world).confirmTransfer({
    userId: USER,
    quoteId: quote.id,
    recipientId: recipient.id,
    answers: ANSWERS,
    idempotencyKey: 'idem-webhooks',
  });
  const system = webhookSystem(world);
  const providerId = transfer.providerTransferId ?? '';
  const status = async () => (await world.transferRepository.findById(transfer.id))?.status;
  return { world, transfer, providerId, status, ...system };
}
