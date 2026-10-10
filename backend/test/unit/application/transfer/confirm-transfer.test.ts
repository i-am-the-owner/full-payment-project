import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetTransferForm } from '../../../../src/application/transfer/confirm-transfer.ts';
import {
  CustomerNotVerifiedError,
  NotSupportedError,
  ProviderUnavailableError,
  QuoteExpiredError,
} from '../../../../src/domain/payout/errors.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../../../../src/shared/errors.ts';
import { ANSWERS, quoteAndRecipient, useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, USER } from '../../../support/transfer-fakes.ts';

async function arrange(
  options: Parameters<typeof buildWorld>[0] = {},
  sourceAmountMinor = 10_000n,
) {
  const world = buildWorld(options);
  const { quote, recipient } = await quoteAndRecipient(world, sourceAmountMinor);
  const input = {
    userId: USER,
    quoteId: quote.id,
    recipientId: recipient.id,
    answers: ANSWERS,
    idempotencyKey: 'idem-1',
  };
  return { world, quote, recipient, input };
}

test('by default the transfer is submitted but NOT funded from a provider balance', async () => {
  const { world, input } = await arrange();
  const { transfer, wasExisting } = await useCases(world).confirmTransfer(input);

  assert.equal(wasExisting, false);
  assert.equal(transfer.status, 'AWAITING_FUNDS');
  assert.equal(transfer.fundingMethod, undefined);
  assert.equal(transfer.provider, 'mock');
  assert.ok(transfer.providerTransferId?.startsWith('mock-transfer-'));
  assert.deepEqual(world.calls, ['updateQuoteWithRecipient', 'createTransfer']);
  assert.ok(world.auditLog.actions().includes('transfer.confirmed'));
  assert.ok(world.auditLog.actions().includes('transfer.submitted'));
});

test('the provider idempotency key is our own transfer UUID, not the client key', async () => {
  const { world, input } = await arrange();
  let providerKey: string | undefined;
  const original = world.mock.createTransfer.bind(world.mock);
  world.mock.createTransfer = (params) => {
    providerKey = params.idempotencyKey;
    return original(params);
  };
  const { transfer } = await useCases(world).confirmTransfer(input);
  assert.equal(providerKey, transfer.id);
  assert.match(transfer.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.notEqual(providerKey, input.idempotencyKey);
});

test('with the balance-funding flag on, confirmation also funds the transfer', async () => {
  const { world, input } = await arrange();
  const { transfer } = await useCases(world, { balanceFunding: true }).confirmTransfer(input);
  assert.equal(transfer.status, 'PROCESSING');
  assert.equal(transfer.fundingMethod, 'BALANCE');
  assert.deepEqual(world.calls, ['updateQuoteWithRecipient', 'createTransfer', 'fundTransfer']);
});

test('an SCA challenge on funding leaves the transfer AWAITING_FUNDS (flag on)', async () => {
  const { world, input } = await arrange({}, 600_000n);
  const { transfer } = await useCases(world, { balanceFunding: true }).confirmTransfer(input);
  assert.equal(transfer.status, 'AWAITING_FUNDS');
  assert.equal(transfer.failureReason, undefined);
});

test('insufficient balance fails the transfer (flag on)', async () => {
  const { world, input } = await arrange({}, 2_500_000n);
  const { transfer } = await useCases(world, { balanceFunding: true }).confirmTransfer(input);
  assert.equal(transfer.status, 'FAILED');
  assert.equal(transfer.failureReason, 'funding:INSUFFICIENT_FUNDS');
});

test('a duplicate request with the same idempotency key returns the original transfer', async () => {
  const { world, input } = await arrange();
  const { confirmTransfer } = useCases(world);
  const first = await confirmTransfer(input);
  world.calls.length = 0;

  const second = await confirmTransfer(input);
  assert.equal(second.wasExisting, true);
  assert.equal(second.transfer.id, first.transfer.id);
  assert.equal(world.transferRepository.transfers.size, 1);
  assert.deepEqual(world.calls, [], 'no second provider call');
});

test('a key replayed with a different quote or recipient is a 409, not the earlier transfer', async () => {
  const { world, input } = await arrange();
  const { confirmTransfer } = useCases(world);
  await confirmTransfer(input);
  world.calls.length = 0;

  await assert.rejects(confirmTransfer({ ...input, quoteId: 'some-other-quote' }), ConflictError);
  await assert.rejects(
    confirmTransfer({ ...input, recipientId: 'some-other-recipient' }),
    ConflictError,
  );
  assert.equal(world.transferRepository.transfers.size, 1);
  assert.deepEqual(world.calls, [], 'nothing was sent to the provider');
});

test('reusing a quote under a NEW idempotency key returns the same transfer, not a second one', async () => {
  const { world, input } = await arrange();
  const { confirmTransfer } = useCases(world);
  const first = await confirmTransfer(input);
  world.calls.length = 0;

  const second = await confirmTransfer({ ...input, idempotencyKey: 'a-fresh-key' });
  assert.equal(second.wasExisting, true);
  assert.equal(second.transfer.id, first.transfer.id);
  assert.equal(world.transferRepository.transfers.size, 1);
  assert.deepEqual(world.calls, []);
});

test('a create race (DB unique violation) still returns the winning transfer', async () => {
  const { world, input } = await arrange();
  world.transferRepository.failNextCreate = true;
  const result = await useCases(world).confirmTransfer(input);
  assert.equal(result.wasExisting, true);
  assert.equal(world.transferRepository.transfers.size, 1);
  assert.equal(result.transfer.reference, 'ALM-RACER');
});

test('an expired quote is rejected and nothing is created', async () => {
  const { world, quote, input } = await arrange();
  world.quoteRepository.patch(quote.id, { expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(useCases(world).confirmTransfer(input), QuoteExpiredError);
  assert.equal(world.transferRepository.transfers.size, 0);
  assert.deepEqual(world.calls, []);
});

test("another user's quote or recipient is forbidden", async () => {
  const { world, quote, recipient, input } = await arrange();
  world.customerLinkStore.seed('intruder');
  await assert.rejects(
    useCases(world).confirmTransfer({ ...input, userId: 'intruder' }),
    ForbiddenError,
  );
  world.quoteRepository.patch(quote.id, { userId: 'intruder' });
  await assert.rejects(
    useCases(world).confirmTransfer({ ...input, userId: 'intruder', recipientId: recipient.id }),
    ForbiddenError,
  );
});

test('a recipient whose currency does not match the quote is rejected', async () => {
  const { world, input } = await arrange();
  const usd = await useCases(world).addRecipient({
    userId: USER,
    currency: 'USD',
    country: 'US',
    values: {
      legalType: 'PRIVATE',
      accountHolderName: 'Sam Jones',
      routingNumber: '021000021',
      accountNumber: '12345678',
      accountType: 'CHECKING',
    },
  });
  await assert.rejects(
    useCases(world).confirmTransfer({ ...input, recipientId: usd.id }),
    ValidationError,
  );
});

test('an unverified customer cannot create a transfer', async () => {
  const { world, input } = await arrange();
  world.customerLinkStore.seed(USER, 'PENDING');
  await assert.rejects(useCases(world).confirmTransfer(input), CustomerNotVerifiedError);
  assert.equal(world.transferRepository.transfers.size, 0);
});

test('a definitive provider rejection fails the transfer (no dangling record)', async () => {
  const { world, input } = await arrange();
  const { transfer } = await useCases(world).confirmTransfer({ ...input, answers: {} });
  assert.equal(transfer.status, 'FAILED');
  assert.equal(transfer.failureReason, 'create:VALIDATION_FAILED');
  assert.ok(world.auditLog.actions().includes('transfer.failed'));
});

test('a price that changed since the customer agreed is never sent', async () => {
  const { world, input } = await arrange();
  world.mock.updateQuoteWithRecipient = (params) =>
    Promise.resolve({
      ...params.quote,
      targetAmount: { ...params.quote.targetAmount, amountMinor: 1n },
    });
  const { transfer } = await useCases(world).confirmTransfer(input);
  assert.equal(transfer.status, 'FAILED');
  assert.equal(transfer.failureReason, 'quote:PRICE_CHANGED');
  assert.equal(world.calls.includes('createTransfer'), false);
});

test('an unanswered provider create does NOT mark the transfer failed', async () => {
  const { world, input } = await arrange({ faults: { createTransferOutcomeUnknown: 1 } });
  const { transfer } = await useCases(world).confirmTransfer(input);

  assert.equal(transfer.status, 'DRAFT');
  assert.equal(transfer.failureReason, undefined);
  assert.ok(world.auditLog.actions().includes('transfer.outcome_unconfirmed'));
  assert.equal(world.auditLog.actions().includes('transfer.failed'), false);
});

test('a retry after an unanswered create resumes the SAME transfer with the SAME provider key', async () => {
  const { world, input } = await arrange({ faults: { createTransferOutcomeUnknown: 1 } });
  const keys: string[] = [];
  const original = world.mock.createTransfer.bind(world.mock);
  world.mock.createTransfer = (params) => {
    keys.push(params.idempotencyKey);
    return original(params);
  };
  const { confirmTransfer } = useCases(world);

  const first = await confirmTransfer(input);
  assert.equal(first.transfer.status, 'DRAFT');

  const second = await confirmTransfer(input);
  assert.equal(second.wasExisting, true);
  assert.equal(second.transfer.id, first.transfer.id);
  assert.equal(second.transfer.status, 'AWAITING_FUNDS');
  assert.equal(world.transferRepository.transfers.size, 1);
  // The first attempt never reached the mock; the retry used our transfer id.
  assert.deepEqual(keys, [first.transfer.id]);
});

test('an unanswered funding call leaves the transfer AWAITING_FUNDS (flag on)', async () => {
  const { world, input } = await arrange({ faults: { fundingOutcomeUnknown: true } });
  const { transfer } = await useCases(world, { balanceFunding: true }).confirmTransfer(input);
  assert.equal(transfer.status, 'AWAITING_FUNDS');
  assert.ok(world.auditLog.actions().includes('transfer.outcome_unconfirmed'));
});

test('the transfer form comes from the provider for the caller’s own quote and recipient', async () => {
  const { world, quote, recipient } = await arrange();
  const form = await createGetTransferForm({ ...world })({
    userId: USER,
    quoteId: quote.id,
    recipientId: recipient.id,
  });
  assert.deepEqual(
    form.fields.map((f) => f.key),
    ['purpose'],
  );
});

// --- Exactly one provider transfer ----------------------------------------------

test('double-clicking Confirm creates exactly one provider transfer', async () => {
  const { world, input } = await arrange();
  const { confirmTransfer } = useCases(world);

  const results = await Promise.all([
    confirmTransfer(input),
    confirmTransfer(input),
    confirmTransfer({ ...input, idempotencyKey: 'a-second-key-for-the-same-quote' }),
  ]);

  assert.equal(world.mock.transferCount, 1);
  assert.equal(world.transferRepository.transfers.size, 1);
  assert.equal(new Set(results.map((r) => r.transfer.id)).size, 1);
  const stored = [...world.transferRepository.transfers.values()][0]!;
  assert.equal(stored.status, 'AWAITING_FUNDS');
  assert.ok(stored.providerTransferId);
});

test('after a timeout, the provider is asked for the transfer BEFORE anything is retried', async () => {
  const { world, input } = await arrange();
  // The provider creates the transfer, but its answer never reaches us.
  const original = world.mock.createTransfer.bind(world.mock);
  let lostAnswers = 1;
  world.mock.createTransfer = async (params) => {
    const created = await original(params);
    if (lostAnswers > 0) {
      lostAnswers -= 1;
      throw new ProviderUnavailableError('timeout', { outcomeUnknown: true });
    }
    return created;
  };
  const { confirmTransfer } = useCases(world);

  const first = await confirmTransfer(input);
  assert.equal(first.transfer.status, 'DRAFT');
  assert.equal(first.transfer.providerTransferId, undefined);
  assert.equal(world.mock.transferCount, 1);

  world.calls.length = 0;
  const second = await confirmTransfer(input);
  // Found by our idempotency key and adopted: no second create was sent.
  assert.deepEqual(world.calls, ['findTransferByIdempotencyKey']);
  assert.equal(second.transfer.id, first.transfer.id);
  assert.equal(second.transfer.status, 'AWAITING_FUNDS');
  assert.ok(second.transfer.providerTransferId?.startsWith('mock-transfer-'));
  assert.equal(world.mock.transferCount, 1);
});

test('if the lookup itself fails, nothing is sent and the transfer stays pending', async () => {
  const { world, input } = await arrange({ faults: { createTransferOutcomeUnknown: 1 } });
  const { confirmTransfer } = useCases(world);
  await confirmTransfer(input);

  world.mock.findTransferByIdempotencyKey = () =>
    Promise.reject(new ProviderUnavailableError('still down'));
  world.calls.length = 0;
  const retry = await confirmTransfer(input);

  assert.deepEqual(world.calls, ['findTransferByIdempotencyKey']);
  assert.equal(retry.transfer.status, 'DRAFT');
  assert.equal(world.mock.transferCount, 0);
});

test('a provider with no lookup gets the create again with the SAME key, never a new one', async () => {
  const { world, input } = await arrange({ faults: { createTransferOutcomeUnknown: 1 } });
  const { confirmTransfer } = useCases(world);
  const first = await confirmTransfer(input);

  world.mock.findTransferByIdempotencyKey = () =>
    Promise.reject(new NotSupportedError('mock', 'findTransferByIdempotencyKey'));
  const keys: string[] = [];
  const original = world.mock.createTransfer.bind(world.mock);
  world.mock.createTransfer = (params) => {
    keys.push(params.idempotencyKey);
    return original(params);
  };
  world.calls.length = 0;
  const retry = await confirmTransfer(input);

  // No re-pricing on a resume: straight to the idempotent create.
  assert.deepEqual(world.calls, ['findTransferByIdempotencyKey', 'createTransfer']);
  assert.deepEqual(keys, [first.transfer.id]);
  assert.equal(retry.transfer.status, 'AWAITING_FUNDS');
  assert.equal(world.mock.transferCount, 1);
});

test('our transfer row exists as DRAFT before the provider is called', async () => {
  const { world, input } = await arrange();
  let rowWhenProviderCalled: string | undefined;
  const original = world.mock.createTransfer.bind(world.mock);
  world.mock.createTransfer = (params) => {
    rowWhenProviderCalled = world.transferRepository.transfers.get(params.idempotencyKey)?.status;
    return original(params);
  };
  await useCases(world).confirmTransfer(input);
  assert.equal(rowWhenProviderCalled, 'DRAFT');
});

test("the customer's reference is stored and sent to the provider; ours is used otherwise", async () => {
  const sent: string[] = [];
  const run = async (reference: string | undefined) => {
    const { world, input } = await arrange();
    const original = world.mock.createTransfer.bind(world.mock);
    world.mock.createTransfer = (params) => {
      sent.push(params.reference);
      return original(params);
    };
    return useCases(world).confirmTransfer({ ...input, reference });
  };
  const withReference = await run('Rent March');
  assert.equal(withReference.transfer.recipientReference, 'Rent March');
  const without = await run(undefined);
  assert.equal(without.transfer.recipientReference, undefined);
  assert.deepEqual(sent, ['Rent March', without.transfer.reference]);
});
