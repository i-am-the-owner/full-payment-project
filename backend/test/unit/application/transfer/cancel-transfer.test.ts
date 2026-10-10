import test from 'node:test';
import assert from 'node:assert/strict';
import { createCancelTransfer } from '../../../../src/application/transfer/cancel-transfer.ts';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../src/shared/errors.ts';
import { ANSWERS, quoteAndRecipient, useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, USER } from '../../../support/transfer-fakes.ts';

async function arrange() {
  const world = buildWorld();
  const { quote, recipient } = await quoteAndRecipient(world);
  const { transfer } = await useCases(world).confirmTransfer({
    userId: USER,
    quoteId: quote.id,
    recipientId: recipient.id,
    answers: ANSWERS,
    idempotencyKey: 'idem-cancel',
  });
  world.calls.length = 0;
  return { world, transfer, cancel: createCancelTransfer(world) };
}

test('a transfer awaiting funds is cancelled at the provider first, then locally', async () => {
  const { world, transfer, cancel } = await arrange();
  const cancelled = await cancel(USER, transfer.id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.deepEqual(world.calls, ['cancelTransfer']);
  assert.ok(world.auditLog.actions().includes('transfer.cancelled'));
});

test('if the provider refuses to cancel, so do we', async () => {
  const { world, transfer, cancel } = await arrange();
  world.mock.advanceTransfer(transfer.providerTransferId ?? '');
  await assert.rejects(cancel(USER, transfer.id), ConflictError);
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'AWAITING_FUNDS');
});

test('a transfer that is processing, sent, completed or failed cannot be cancelled', async () => {
  const { world, transfer, cancel } = await arrange();
  for (const status of ['PROCESSING', 'SENT', 'COMPLETED', 'FAILED'] as const) {
    const stored = world.transferRepository.transfers.get(transfer.id);
    if (stored) {
      stored.status = status;
    }
    await assert.rejects(cancel(USER, transfer.id), ConflictError, status);
  }
  assert.deepEqual(world.calls, [], 'the provider is not even asked');
});

test("another user's transfer cannot be cancelled; an unknown one is not found", async () => {
  const { transfer, cancel } = await arrange();
  await assert.rejects(cancel('someone-else', transfer.id), ForbiddenError);
  await assert.rejects(cancel(USER, '00000000-0000-4000-8000-000000000000'), NotFoundError);
});
