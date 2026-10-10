import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAddRecipient,
  createRemoveRecipient,
} from '../../../../src/application/transfer/add-recipient.ts';
import {
  createFundTransfer,
  createGetTransferFunding,
} from '../../../../src/application/transfer/fund-transfer.ts';
import { createAttachRecipientToQuote } from '../../../../src/application/transfer/reprice-quote.ts';
import {
  createGetTransferDetail,
  createListRecipients,
  createListTransfers,
} from '../../../../src/application/transfer/transfer-queries.ts';
import {
  CustomerNotVerifiedError,
  InsufficientFundsError,
  ProviderUnavailableError,
  QuoteExpiredError,
  ScaRequiredError,
} from '../../../../src/domain/payout/errors.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../../../../src/shared/errors.ts';
import { ANSWERS, quoteAndRecipient, useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, EUR_RECIPIENT_VALUES, USER } from '../../../support/transfer-fakes.ts';

async function confirmed(
  sourceAmountMinor = 10_000n,
  options: Parameters<typeof buildWorld>[0] = {},
) {
  const world = buildWorld(options);
  const { quote, recipient } = await quoteAndRecipient(world, sourceAmountMinor);
  const { transfer } = await useCases(world).confirmTransfer({
    userId: USER,
    quoteId: quote.id,
    recipientId: recipient.id,
    answers: ANSWERS,
    idempotencyKey: 'idem-1',
  });
  world.calls.length = 0;
  return { world, quote, recipient, transfer };
}

// --- Quote re-pricing for a recipient ---------------------------------------------

test('attaching a person keeps the quote; nothing new is stored', async () => {
  const world = buildWorld();
  const { quote, recipient } = await quoteAndRecipient(world);
  const attach = createAttachRecipientToQuote(world);

  const result = await attach({ userId: USER, quoteId: quote.id, recipientId: recipient.id });
  assert.equal(result.priceChanged, false);
  assert.equal(result.quote.id, quote.id);
  assert.equal(world.quoteRepository.quotes.size, 1);
});

test('when the price changes a NEW quote is stored, and only that one can be confirmed', async () => {
  const world = buildWorld();
  const { quote } = await quoteAndRecipient(world);
  const business = await createAddRecipient(world)({
    userId: USER,
    currency: 'EUR',
    country: 'DE',
    values: { ...EUR_RECIPIENT_VALUES, legalType: 'BUSINESS', businessName: 'Schmidt GmbH' },
  });
  const attach = createAttachRecipientToQuote(world);

  const result = await attach({ userId: USER, quoteId: quote.id, recipientId: business.id });
  assert.equal(result.priceChanged, true);
  assert.notEqual(result.quote.id, quote.id);
  assert.equal(result.quote.totalToPay.amountMinor, quote.totalToPay.amountMinor);
  assert.equal(result.quote.fee.amountMinor, quote.fee.amountMinor + 50n);
  assert.ok(result.quote.target.amountMinor < quote.target.amountMinor);
  // The first quote is untouched: stored quotes are immutable.
  assert.equal(
    (await world.quoteRepository.findById(quote.id))?.fee.amountMinor,
    quote.fee.amountMinor,
  );
  assert.ok(world.auditLog.actions().includes('transfer.quote.repriced'));

  const { confirmTransfer } = useCases(world);
  const base = { userId: USER, recipientId: business.id, answers: ANSWERS };
  // The old figures are never sent.
  const stale = await confirmTransfer({ ...base, quoteId: quote.id, idempotencyKey: 'k-old' });
  assert.equal(stale.transfer.status, 'FAILED');
  assert.equal(stale.transfer.failureReason, 'quote:PRICE_CHANGED');
  assert.equal(world.mock.transferCount, 0);

  const fresh = await confirmTransfer({
    ...base,
    quoteId: result.quote.id,
    idempotencyKey: 'k-new',
  });
  assert.equal(fresh.transfer.status, 'AWAITING_FUNDS');
  assert.equal(fresh.transfer.fee.amountMinor, quote.fee.amountMinor + 50n);
});

test('re-pricing refuses an expired quote, someone else’s quote and a mismatched recipient', async () => {
  let now = new Date('2026-10-03T10:00:00Z');
  const world = buildWorld({ clock: () => now });
  const { quote, recipient } = await quoteAndRecipient(world);
  const attach = createAttachRecipientToQuote(world);
  const input = { userId: USER, quoteId: quote.id, recipientId: recipient.id };

  await assert.rejects(attach({ ...input, userId: 'intruder' }), CustomerNotVerifiedError);
  world.customerLinkStore.seed('intruder');
  await assert.rejects(attach({ ...input, userId: 'intruder' }), ForbiddenError);

  const usd = await useCases(world).requestQuote({
    userId: USER,
    sourceCurrency: 'GBP',
    targetCurrency: 'USD',
    sourceAmountMinor: 10_000n,
  });
  await assert.rejects(attach({ ...input, quoteId: usd.id }), ValidationError);

  now = new Date(now.getTime() + 31 * 60 * 1000);
  world.calls.length = 0;
  await assert.rejects(attach(input), QuoteExpiredError);
  assert.deepEqual(world.calls, []);
});

// --- Recipients: soft delete -------------------------------------------------------

test('removing a recipient hides it from the list but keeps the record', async () => {
  const world = buildWorld();
  const { recipient } = await quoteAndRecipient(world);
  const remove = createRemoveRecipient(world);

  await assert.rejects(remove('someone-else', recipient.id), ForbiddenError);
  await remove(USER, recipient.id);
  await remove(USER, recipient.id); // harmless twice

  assert.deepEqual(await createListRecipients(world)(USER), []);
  assert.equal((await world.recipientRepository.findById(recipient.id))?.isActive, false);
  assert.equal(world.auditLog.actions().filter((a) => a === 'recipient.removed').length, 1);
});

test('a removed recipient cannot be sent to', async () => {
  const world = buildWorld();
  const { quote, recipient } = await quoteAndRecipient(world);
  await createRemoveRecipient(world)(USER, recipient.id);
  await assert.rejects(
    useCases(world).confirmTransfer({
      userId: USER,
      quoteId: quote.id,
      recipientId: recipient.id,
      answers: ANSWERS,
      idempotencyKey: 'idem-1',
    }),
    ValidationError,
  );
  assert.equal(world.transferRepository.transfers.size, 0);
});

// --- Paying the provider -----------------------------------------------------------

test('funding instructions name the provider and carry its bank details and reference', async () => {
  const { world, transfer } = await confirmed();
  const funding = await createGetTransferFunding(world)(USER, transfer.id);

  assert.deepEqual(funding.provider, {
    name: 'mock',
    displayName: 'Mock Payments (test provider)',
  });
  assert.deepEqual(
    funding.methods.map((m) => m.method),
    ['BANK_TRANSFER', 'BALANCE'],
  );
  const bank = funding.methods[0]!;
  assert.ok(bank.method === 'BANK_TRANSFER');
  assert.deepEqual(bank.amount, transfer.totalToPay);
  assert.match(bank.reference, /^MOCK/);
  assert.ok(bank.bankDetails.length > 0);
  // The bank details are passed through, not stored or audited.
  assert.ok(!JSON.stringify(world.auditLog.entries).includes('00000000'));

  await assert.rejects(
    createGetTransferFunding(world)('someone-else', transfer.id),
    ForbiddenError,
  );
});

test('paying from the customer’s own balance moves the transfer on, from the provider’s answer', async () => {
  const { world, transfer } = await confirmed();
  const result = await createFundTransfer(world)({
    userId: USER,
    transferId: transfer.id,
    method: 'BALANCE',
  });

  assert.equal(result.outcome, 'FUNDED');
  assert.equal(result.transfer.status, 'PROCESSING');
  assert.equal(result.transfer.fundingMethod, 'BALANCE');
  const events = await world.transferRepository.listEvents(transfer.id);
  assert.deepEqual(events.at(-1), {
    status: 'PROCESSING',
    source: 'PROVIDER_RESPONSE',
    occurredAt: events.at(-1)!.occurredAt,
    applied: true,
  });

  // Paying twice is refused: it is no longer waiting for payment.
  await assert.rejects(
    createFundTransfer(world)({ userId: USER, transferId: transfer.id, method: 'BALANCE' }),
    ConflictError,
  );
});

test('choosing bank transfer changes no status: the customer still has to pay the provider', async () => {
  const { world, transfer } = await confirmed();
  const result = await createFundTransfer(world)({
    userId: USER,
    transferId: transfer.id,
    method: 'BANK_TRANSFER',
  });
  assert.equal(result.outcome, 'AWAITING_PAYMENT');
  assert.equal(result.transfer.status, 'AWAITING_FUNDS');
  assert.match(result.message ?? '', /waiting for your payment/);
  assert.equal(
    (await world.transferRepository.findById(transfer.id))?.fundingMethod,
    'BANK_TRANSFER',
  );
});

test('when the provider wants the customer to approve, we say so and change nothing', async () => {
  // Above the mock's SCA threshold (5,000.00).
  const { world, transfer } = await confirmed(600_000n);
  const fund = createFundTransfer(world);
  const result = await fund({ userId: USER, transferId: transfer.id, method: 'BALANCE' });
  assert.equal(result.outcome, 'SCA_REQUIRED');
  assert.match(result.message ?? '', /approve this payment/);
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'AWAITING_FUNDS');

  // A provider that signals SCA with an error is handled the same way.
  world.mock.fundTransfer = () => Promise.reject(new ScaRequiredError());
  const thrown = await fund({ userId: USER, transferId: transfer.id, method: 'BALANCE' });
  assert.equal(thrown.outcome, 'SCA_REQUIRED');
});

test('too little balance is a typed error and the transfer can still be paid another way', async () => {
  // Above the mock balance (20,000.00).
  const { world, transfer } = await confirmed(2_500_000n);
  const fund = createFundTransfer(world);
  await assert.rejects(
    fund({ userId: USER, transferId: transfer.id, method: 'BALANCE' }),
    InsufficientFundsError,
  );
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'AWAITING_FUNDS');
  const bank = await fund({ userId: USER, transferId: transfer.id, method: 'BANK_TRANSFER' });
  assert.equal(bank.outcome, 'AWAITING_PAYMENT');
});

test('an unanswered funding call records nothing and never marks the transfer paid or failed', async () => {
  const { world, transfer } = await confirmed(10_000n, { faults: { fundingOutcomeUnknown: true } });
  await assert.rejects(
    createFundTransfer(world)({ userId: USER, transferId: transfer.id, method: 'BALANCE' }),
    ProviderUnavailableError,
  );
  const stored = await world.transferRepository.findById(transfer.id);
  assert.equal(stored?.status, 'AWAITING_FUNDS');
  assert.equal(stored?.fundingMethod, undefined);
});

test('a way of paying the provider does not offer is refused', async () => {
  const { world, transfer } = await confirmed();
  world.mock.getFundingInstructions = () =>
    Promise.resolve([
      { method: 'BANK_TRANSFER', amount: transfer.totalToPay, bankDetails: [], reference: 'X' },
    ]);
  await assert.rejects(
    createFundTransfer(world)({ userId: USER, transferId: transfer.id, method: 'BALANCE' }),
    ConflictError,
  );
  assert.ok(!world.calls.includes('fundTransfer'));
});

// --- History from our own database ------------------------------------------------

test('history is paged, newest first, and never calls the provider', async () => {
  let now = new Date('2026-10-03T10:00:00Z');
  const world = buildWorld({ clock: () => now });
  const references: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const { quote, recipient } = await quoteAndRecipient(world);
    const { transfer } = await useCases(world).confirmTransfer({
      userId: USER,
      quoteId: quote.id,
      recipientId: recipient.id,
      answers: ANSWERS,
      idempotencyKey: `idem-${i}`,
    });
    references.unshift(transfer.reference);
    now = new Date(now.getTime() + 60_000);
  }
  world.calls.length = 0;
  const list = createListTransfers(world);

  const first = await list(USER, { page: 1, pageSize: 2 });
  assert.deepEqual(
    first.transfers.map((t) => t.reference),
    references.slice(0, 2),
  );
  assert.equal(first.hasMore, true);
  const last = await list(USER, { page: 3, pageSize: 2 });
  assert.deepEqual(
    last.transfers.map((t) => t.reference),
    references.slice(4),
  );
  assert.equal(last.hasMore, false);
  assert.deepEqual((await list('someone-else', { page: 1, pageSize: 2 })).transfers, []);
  assert.deepEqual(world.calls, []);
});

test('transfer detail carries the status timeline and the recipient summary', async () => {
  const { world, transfer, recipient } = await confirmed();
  await createFundTransfer(world)({ userId: USER, transferId: transfer.id, method: 'BALANCE' });
  world.calls.length = 0;

  const detail = await createGetTransferDetail(world)(USER, transfer.id);
  assert.deepEqual(
    detail.events.map((e) => e.status),
    ['DRAFT', 'AWAITING_FUNDS', 'PROCESSING'],
  );
  assert.equal(detail.recipient?.id, recipient.id);
  assert.deepEqual(world.calls, []);

  await assert.rejects(createGetTransferDetail(world)('someone-else', transfer.id), ForbiddenError);
});
