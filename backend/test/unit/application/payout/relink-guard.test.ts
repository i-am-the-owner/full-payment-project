import test from 'node:test';
import assert from 'node:assert/strict';
import { requireVerifiedLink } from '../../../../src/application/payout/customer-onboarding.ts';
import { withRelinkGuard } from '../../../../src/application/payout/relink-guard.ts';
import {
  CustomerNotVerifiedError,
  NeedsRelinkError,
  ProviderUnavailableError,
} from '../../../../src/domain/payout/errors.ts';
import { createRequestQuote } from '../../../../src/application/transfer/request-quote.ts';
import { buildWorld, USER } from '../../../support/transfer-fakes.ts';

const QUOTE = {
  userId: USER,
  sourceCurrency: 'GBP',
  targetCurrency: 'EUR',
  sourceAmountMinor: 10_000n,
};

test('when the provider refuses the customer tokens, the link becomes NEEDS_RELINK', async () => {
  const world = buildWorld();
  world.mock.createQuote = () => Promise.reject(new NeedsRelinkError());
  const provider = withRelinkGuard(world.provider, world.customerLinkStore);
  const requestQuote = createRequestQuote({ ...world, provider });

  await assert.rejects(requestQuote(QUOTE), NeedsRelinkError);
  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'NEEDS_RELINK');

  // From now on sending is blocked before the provider is even called.
  world.calls.length = 0;
  await assert.rejects(requestQuote(QUOTE), NeedsRelinkError);
  assert.deepEqual(world.calls, []);
});

test('other provider failures leave the link alone', async () => {
  const world = buildWorld();
  world.mock.createQuote = () => Promise.reject(new ProviderUnavailableError());
  const provider = withRelinkGuard(world.provider, world.customerLinkStore);

  await assert.rejects(createRequestQuote({ ...world, provider })(QUOTE), ProviderUnavailableError);
  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'VERIFIED');
});

test('the guard passes results and non-function properties straight through', async () => {
  const world = buildWorld();
  const provider = withRelinkGuard(world.provider, world.customerLinkStore);
  assert.equal(provider.name, 'mock');
  const quote = await createRequestQuote({ ...world, provider })(QUOTE);
  assert.equal(quote.userId, USER);
});

test('only a VERIFIED link may send; every other status is refused', async () => {
  const world = buildWorld();
  for (const status of ['PENDING', 'REJECTED', 'REJECTED_PENDING_REVIEW'] as const) {
    world.customerLinkStore.seed(USER, status);
    await assert.rejects(requireVerifiedLink(world, USER), CustomerNotVerifiedError);
  }
  world.customerLinkStore.seed(USER, 'NEEDS_RELINK');
  await assert.rejects(requireVerifiedLink(world, USER), NeedsRelinkError);
  world.customerLinkStore.unlink(USER);
  await assert.rejects(requireVerifiedLink(world, USER), CustomerNotVerifiedError);
});
