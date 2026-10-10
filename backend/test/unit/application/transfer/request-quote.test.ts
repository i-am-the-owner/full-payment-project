import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerNotVerifiedError,
  NeedsRelinkError,
  RouteNotSupportedError,
} from '../../../../src/domain/payout/errors.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import { useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, USER } from '../../../support/transfer-fakes.ts';

test('a quote stores the provider figures: principal + fee = what the customer pays', async () => {
  const world = buildWorld();
  const quote = await useCases(world).requestQuote({
    userId: USER,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });

  assert.equal(quote.provider, 'mock');
  assert.ok(quote.providerQuoteId?.startsWith('mock-quote-'));
  assert.deepEqual(quote.fee, { currency: 'GBP', amountMinor: 90n });
  assert.deepEqual(quote.source, { currency: 'GBP', amountMinor: 9_910n });
  assert.deepEqual(quote.totalToPay, { currency: 'GBP', amountMinor: 10_000n });
  assert.deepEqual(quote.target, { currency: 'EUR', amountMinor: 11_594n });
  assert.equal(quote.exchangeRate, '1.17');
  assert.ok(world.auditLog.actions().includes('transfer.quote.created'));
});

test('the provider currency list is cached locally so amounts can be formatted later', async () => {
  const world = buildWorld();
  await useCases(world).requestQuote({
    userId: USER,
    sourceCurrency: 'GBP',
    targetCurrency: 'INR',
    targetAmountMinor: 500_000n,
  });
  assert.equal(await world.currencyRegistry.minorUnitExponent('INR'), 2);
  assert.equal(world.currencyRegistry.currencies.size, 7);
});

test('exactly one of source amount and target amount is required', async () => {
  const { requestQuote } = useCases(buildWorld());
  const base = { userId: USER, sourceCurrency: 'GBP', targetCurrency: 'EUR' };
  await assert.rejects(requestQuote(base), ValidationError);
  await assert.rejects(
    requestQuote({ ...base, sourceAmountMinor: 1_000n, targetAmountMinor: 1_000n }),
    ValidationError,
  );
});

test('a route the provider does not list is refused before the provider is asked to price it', async () => {
  const world = buildWorld();
  await assert.rejects(
    useCases(world).requestQuote({
      userId: USER,
      sourceCurrency: 'INR',
      targetCurrency: 'GBP',
      sourceAmountMinor: 10_000n,
    }),
    RouteNotSupportedError,
  );
  assert.equal(world.calls.includes('createQuote'), false);
});

test('a customer the provider has not verified cannot get a quote', async () => {
  const world = buildWorld();
  world.customerLinkStore.unlink(USER);
  const input = {
    userId: USER,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  };
  await assert.rejects(useCases(world).requestQuote(input), CustomerNotVerifiedError);

  world.customerLinkStore.seed(USER, 'PENDING');
  await assert.rejects(useCases(world).requestQuote(input), CustomerNotVerifiedError);

  world.customerLinkStore.seed(USER, 'NEEDS_RELINK');
  await assert.rejects(useCases(world).requestQuote(input), NeedsRelinkError);

  // A link to a different provider is no use to the active one.
  world.customerLinkStore.unlink(USER);
  world.customerLinkStore.seed(USER, 'VERIFIED', 'wise');
  await assert.rejects(useCases(world).requestQuote(input), CustomerNotVerifiedError);
  assert.deepEqual(
    world.calls.filter((c) => c === 'createQuote'),
    [],
  );
});
