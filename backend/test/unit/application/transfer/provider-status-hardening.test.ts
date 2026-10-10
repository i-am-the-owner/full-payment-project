import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplyProviderTransferUpdate } from '../../../../src/application/transfer/apply-provider-transfer-update.ts';
import { createCancelTransfer } from '../../../../src/application/transfer/cancel-transfer.ts';
import {
  InvalidTransferTransitionError,
  type ProviderStatusEvidence,
} from '../../../../src/application/transfer/ports.ts';
import { createRefreshTransfer } from '../../../../src/application/transfer/transfer-queries.ts';
import type { TransferStatus } from '../../../../src/domain/payout/transfer-status.ts';
import { ConflictError } from '../../../../src/shared/errors.ts';
import { ANSWERS, quoteAndRecipient, useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, USER } from '../../../support/transfer-fakes.ts';

/**
 * A transfer SomPay recorded as FAILED may be corrected only by provider data
 * (a verified webhook or a provider lookup), and every correction is audited.
 * No user- or admin-facing path can do it.
 */

async function arrange(status: TransferStatus = 'FAILED') {
  const world = buildWorld();
  const { quote, recipient } = await quoteAndRecipient(world);
  const { transfer } = await useCases(world).confirmTransfer({
    userId: USER,
    quoteId: quote.id,
    recipientId: recipient.id,
    answers: ANSWERS,
    idempotencyKey: 'idem-harden',
  });
  const stored = world.transferRepository.transfers.get(transfer.id);
  if (stored) {
    stored.status = status;
  }
  world.auditLog.entries.length = 0;
  world.calls.length = 0;
  const apply = createApplyProviderTransferUpdate(world);
  const evidence = (to: TransferStatus, source: ProviderStatusEvidence['source']) =>
    ({
      source,
      provider: 'mock',
      providerTransferId: transfer.providerTransferId ?? '',
      providerStatus: 'delivered',
      status: to,
      occurredAt: new Date(),
    }) satisfies ProviderStatusEvidence;
  return { world, transfer, apply, evidence };
}

test('a provider webhook corrects FAILED to COMPLETED, and the correction is audited', async () => {
  const { world, transfer, apply, evidence } = await arrange();
  const outcome = await apply(evidence('COMPLETED', 'provider_webhook'));

  assert.equal(outcome.applied, true);
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'COMPLETED');

  const audit = world.auditLog.entries.find(
    (e) => e.action === 'transfer.status_corrected_by_provider',
  );
  assert.ok(audit, 'the correction must be in the audit log');
  assert.equal(audit.actorType, 'provider');
  assert.equal(audit.entityId, transfer.id);
  assert.deepEqual(audit.context, {
    from: 'FAILED',
    to: 'COMPLETED',
    provider: 'mock',
    providerStatus: 'delivered',
    source: 'provider_webhook',
  });
});

test('a provider lookup also corrects FAILED, with its own source in the audit log', async () => {
  const { world, transfer } = await arrange();
  // The provider says the transfer was in fact paid out.
  world.mock.advanceTransfer(transfer.providerTransferId ?? '', 'paid_out');

  const refreshed = await createRefreshTransfer({
    ...world,
    applyProviderTransferUpdate: createApplyProviderTransferUpdate(world),
  })(USER, transfer.id);

  assert.equal(refreshed.status, 'SENT');
  const audit = world.auditLog.entries.find(
    (e) => e.action === 'transfer.status_corrected_by_provider',
  );
  assert.equal(audit?.context?.source, 'provider_lookup');
  assert.equal(audit?.context?.providerStatus, 'paid_out');
});

test('the local (non-provider) status path cannot move a transfer out of FAILED', async () => {
  const { world, transfer } = await arrange();
  // The type of applyLocalStatusChange only admits FAILED and CANCELLED...
  await assert.rejects(
    world.transferRepository.applyLocalStatusChange(transfer.id, {
      status: 'CANCELLED',
      failureReason: 'attempt',
      actor: 'user',
    }),
    InvalidTransferTransitionError,
  );
  // ...and even a caller that bypasses the types is refused by the state machine.
  await assert.rejects(
    world.transferRepository.applyLocalStatusChange(transfer.id, {
      status: 'COMPLETED' as never,
      failureReason: 'attempt',
      actor: 'system',
    }),
    InvalidTransferTransitionError,
  );
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'FAILED');
  assert.deepEqual(world.auditLog.entries, []);
});

test('no customer action changes a FAILED transfer: cancel is refused, replay returns it as is', async () => {
  const { world, transfer } = await arrange();
  await assert.rejects(createCancelTransfer(world)(USER, transfer.id), ConflictError);

  const replay = await useCases(world).confirmTransfer({
    userId: USER,
    quoteId: transfer.quoteId,
    recipientId: transfer.recipientId,
    answers: ANSWERS,
    idempotencyKey: 'idem-harden',
  });
  assert.equal(replay.transfer.status, 'FAILED');
  assert.deepEqual(world.calls, [], 'no provider call was made');
});

test('provider evidence for a different transfer does not touch this one', async () => {
  const { world, transfer, apply, evidence } = await arrange();
  const outcome = await apply({
    ...evidence('COMPLETED', 'provider_webhook'),
    providerTransferId: 'mock-transfer-someone-elses',
  });
  assert.deepEqual(outcome, { applied: false, reason: 'unknown_transfer' });
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'FAILED');
});

test('an impossible or backwards provider status is ignored, never forced', async () => {
  const { world, transfer, apply, evidence } = await arrange('COMPLETED');
  const outcome = await apply(evidence('AWAITING_FUNDS', 'provider_webhook'));
  assert.equal(outcome.applied, false);
  assert.equal(outcome.applied === false && outcome.reason, 'invalid_transition');
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'COMPLETED');
  assert.deepEqual(world.auditLog.entries, []);
});

test('a terminal transfer stays terminal even with provider evidence', async () => {
  const { world, transfer, apply, evidence } = await arrange('CANCELLED');
  const outcome = await apply(evidence('COMPLETED', 'provider_webhook'));
  assert.equal(outcome.applied, false);
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'CANCELLED');
});

test('an ordinary provider update is audited as a status change, not a correction', async () => {
  const { world, apply, evidence } = await arrange('AWAITING_FUNDS');
  await apply(evidence('PROCESSING', 'provider_webhook'));
  assert.deepEqual(world.auditLog.actions(), ['transfer.status_changed']);
});
