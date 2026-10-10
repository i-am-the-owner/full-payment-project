import test from 'node:test';
import assert from 'node:assert/strict';
import { LimitExceededError } from '../../../../src/application/transfer/transfer-limits.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import { ANSWERS, quoteAndRecipient, useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, USER } from '../../../support/transfer-fakes.ts';

const LIMITS = { perTransfer: '500.00', perDay: '800.00', perMonth: '1500.00' };
const DAY = 24 * 60 * 60 * 1000;

function arrange() {
  let now = new Date('2026-10-03T10:00:00Z');
  const world = buildWorld({ limits: LIMITS, clock: () => now });
  let n = 0;
  /** Confirms a transfer where the customer pays `pounds` in total. */
  const send = async (pounds: number) => {
    const { quote, recipient } = await quoteAndRecipient(world, BigInt(pounds * 100));
    n += 1;
    return useCases(world).confirmTransfer({
      userId: USER,
      quoteId: quote.id,
      recipientId: recipient.id,
      answers: ANSWERS,
      idempotencyKey: `idem-${n}`,
    });
  };
  const limitOf = async (pounds: number): Promise<string> => {
    try {
      await send(pounds);
    } catch (error) {
      assert.ok(error instanceof LimitExceededError, String(error));
      assert.equal(error.httpStatus, 422);
      assert.equal(error.code, 'LIMIT_EXCEEDED');
      return error.limit;
    }
    return 'NONE';
  };
  return {
    world,
    send,
    limitOf,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

test('a transfer over the per-transfer limit is refused before anything is created', async () => {
  const { world, limitOf, send } = arrange();
  assert.equal(await limitOf(500.01), 'PER_TRANSFER');
  assert.equal(world.transferRepository.transfers.size, 0);
  assert.ok(!world.calls.includes('createTransfer'));

  // Exactly at the limit is allowed. The limit counts the fee too.
  const { transfer } = await send(500);
  assert.equal(transfer.totalToPay.amountMinor, 50_000n);
});

test('the error tells the customer the limit in plain words', async () => {
  const { send } = arrange();
  await assert.rejects(send(600), /You can send up to 500\.00 GBP in one transfer\./);
});

test('the daily limit is a rolling 24 hours', async () => {
  const { limitOf, send, advance } = arrange();
  await send(500);
  await send(300);
  assert.equal(await limitOf(1), 'PER_DAY');

  advance(DAY - 60_000);
  assert.equal(await limitOf(1), 'PER_DAY');
  advance(2 * 60_000);
  assert.equal(await limitOf(1), 'NONE');
});

test('the monthly limit is a rolling 30 days', async () => {
  const { limitOf, send, advance } = arrange();
  for (const amount of [500, 500, 400]) {
    await send(amount);
    advance(DAY + 60_000);
  }
  // 1,400 used; the day is clear, so only the month can refuse.
  assert.equal(await limitOf(101), 'PER_MONTH');
  assert.equal(await limitOf(100), 'NONE');
  assert.equal(await limitOf(1), 'PER_MONTH');

  advance(30 * DAY);
  assert.equal(await limitOf(500), 'NONE');
});

test('cancelled and failed transfers do not count towards the limits', async () => {
  const { world, limitOf, send } = arrange();
  const first = await send(500);
  const second = await send(300);
  assert.equal(await limitOf(100), 'PER_DAY');

  await world.transferRepository.applyLocalStatusChange(first.transfer.id, {
    status: 'CANCELLED',
    failureReason: 'cancelled_by_customer',
    actor: 'user',
  });
  await world.transferRepository.applyLocalStatusChange(second.transfer.id, {
    status: 'FAILED',
    failureReason: 'test',
    actor: 'system',
  });
  assert.equal(await limitOf(500), 'NONE');
});

test('limits are per customer', async () => {
  const { world, send } = arrange();
  await send(500);
  await send(300);
  assert.equal(
    await world.transferRepository.totalPaidSince('someone-else', 'GBP', new Date(0)),
    0n,
  );
  await world.transferLimits.check('someone-else', { currency: 'GBP', amountMinor: 50_000n });
});

test('a currency with no configured limit cannot be sent from', async () => {
  const { world } = arrange();
  await assert.rejects(
    world.transferLimits.check(USER, { currency: 'EUR', amountMinor: 100n }),
    ValidationError,
  );
});
