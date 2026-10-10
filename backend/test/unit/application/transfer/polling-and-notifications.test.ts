import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderUnavailableError } from '../../../../src/domain/payout/errors.ts';
import { transferWithWebhooks } from '../../../support/webhook-world.ts';

const MINUTE = 60_000;

/** A world whose clock the test controls. */
async function arrange(sourceAmountMinor = 10_000n) {
  const clock = { now: new Date('2026-10-03T10:00:00Z') };
  const t = await transferWithWebhooks({ clock: () => clock.now }, sourceAmountMinor);
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const events = () => t.world.transferRepository.events.get(t.transfer.id) ?? [];
  return { ...t, clock, advance, events };
}

// --- Safety-net polling -------------------------------------------------------------

test('polling updates a stuck transfer the webhook never reported (source POLL)', async () => {
  const { world, transfer, providerId, status, pollStuckTransfers, runner, advance, events } =
    await arrange();
  // The provider paid out, but its webhook was lost: SomPay never heard.
  world.mock.advanceTransfer(providerId, 'paid_out');
  assert.equal(await status(), 'AWAITING_FUNDS');

  advance(31 * MINUTE);
  const summary = await pollStuckTransfers();

  assert.deepEqual(summary, { checked: 1, changed: 1, adopted: 0, errors: 0 });
  assert.equal(await status(), 'SENT');
  assert.equal(events().at(-1)?.source, 'POLL');
  assert.equal(events().at(-1)?.applied, true);
  assert.ok(world.auditLog.entries.some((e) => e.context?.source === 'provider_lookup'));

  // The customer is told, like any other change.
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), ['SENT']);
  assert.equal(
    world.transferRepository.lastPolled.get(transfer.id)?.getTime(),
    world.clock().getTime(),
  );
});

test('only transfers that are not final and have not changed for 30 minutes are polled', async () => {
  const { world, transfer, providerId, pollStuckTransfers, advance } = await arrange();
  world.mock.advanceTransfer(providerId, 'paid_out');

  advance(20 * MINUTE);
  assert.equal((await pollStuckTransfers()).checked, 0, 'changed 20 minutes ago: not stuck');
  advance(11 * MINUTE);
  world.calls.length = 0;
  assert.equal((await pollStuckTransfers()).checked, 1);
  assert.deepEqual(world.calls, ['getTransfer']);

  // It is now SENT and was just updated: not stuck again.
  advance(MINUTE);
  assert.equal((await pollStuckTransfers()).checked, 0);

  // Final transfers are never polled, however old.
  world.mock.advanceTransfer(providerId, 'delivered');
  advance(31 * MINUTE);
  await pollStuckTransfers();
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'COMPLETED');
  advance(60 * MINUTE);
  world.calls.length = 0;
  assert.equal((await pollStuckTransfers()).checked, 0);
  assert.deepEqual(world.calls, []);
});

test('a transfer that is simply still waiting is not polled more often than the minimum gap', async () => {
  const { world, pollStuckTransfers, advance } = await arrange();
  advance(31 * MINUTE);
  assert.equal((await pollStuckTransfers()).checked, 1);
  world.calls.length = 0;

  advance(5 * MINUTE);
  assert.equal((await pollStuckTransfers()).checked, 0);
  advance(6 * MINUTE);
  assert.equal((await pollStuckTransfers()).checked, 1);
});

test('a provider error on one transfer does not stop the poll, and it is tried again later', async () => {
  const { world, transfer, pollStuckTransfers, advance } = await arrange();
  world.mock.getTransfer = () => Promise.reject(new ProviderUnavailableError());
  advance(31 * MINUTE);

  const summary = await pollStuckTransfers();
  assert.equal(summary.errors, 1);
  assert.equal(summary.changed, 0);
  assert.equal((await world.transferRepository.findById(transfer.id))?.status, 'AWAITING_FUNDS');
  assert.ok(world.transferRepository.lastPolled.has(transfer.id), 'rotates on to the next');
});

test('polling adopts a transfer the provider created but never answered for, and creates nothing', async () => {
  const world = (await arrange()).world;
  // A fresh transfer whose create call was lost: stays DRAFT with no provider id.
  const lost = await arrange();
  const stored = lost.world.transferRepository.transfers.get(lost.transfer.id)!;
  const providerId = stored.providerTransferId!;
  stored.providerTransferId = undefined;
  stored.provider = undefined;
  stored.status = 'DRAFT';
  void world;

  lost.advance(31 * MINUTE);
  lost.world.calls.length = 0;
  const summary = await lost.pollStuckTransfers();

  assert.equal(summary.adopted, 1);
  assert.ok(lost.world.calls.includes('findTransferByIdempotencyKey'));
  assert.ok(!lost.world.calls.includes('createTransfer'));
  const adopted = await lost.world.transferRepository.findById(lost.transfer.id);
  assert.equal(adopted?.providerTransferId, providerId);
  assert.equal(adopted?.status, 'AWAITING_FUNDS');
});

test('a transfer the provider has never heard of is reported to an admin after an hour', async () => {
  const t = await arrange();
  const stored = t.world.transferRepository.transfers.get(t.transfer.id)!;
  stored.providerTransferId = undefined;
  stored.provider = undefined;
  stored.status = 'DRAFT';
  t.world.mock.findTransferByIdempotencyKey = () => Promise.resolve(null);

  t.advance(31 * MINUTE);
  await t.pollStuckTransfers();
  assert.deepEqual(t.world.adminAlerts.kinds(), [], 'too early to worry');

  t.advance(40 * MINUTE);
  await t.pollStuckTransfers();
  assert.deepEqual(t.world.adminAlerts.kinds(), ['TRANSFER_NOT_CONFIRMED']);
});

// --- Customer notifications -----------------------------------------------------------

test('each key status change sends the right message, with the amount and the recipient', async () => {
  const { world, receive, runner, providerId } = await arrange();
  const step = async (status: 'funded' | 'paid_out' | 'delivered') => {
    await receive(world.mock.advanceTransfer(providerId, status));
    await runner.drain();
  };

  await step('funded');
  await step('paid_out');
  await step('delivered');

  assert.deepEqual(world.mailer.kinds(), ['FUNDS_RECEIVED', 'SENT', 'DELIVERED']);
  const [received, sent, delivered] = world.mailer.notices;
  for (const { to, notice } of world.mailer.notices) {
    assert.equal(to, 'jane@example.test');
    assert.ok(notice.text.includes('Anna Schmidt'), 'names the recipient');
    assert.ok(notice.text.includes('ALM-'), 'carries the reference');
  }
  assert.match(
    received!.notice.subject,
    /Mock Payments \(test provider\) has received your 100\.00 GBP/,
  );
  assert.match(received!.notice.text, /sending 115\.94 EUR to Anna Schmidt/);
  assert.match(sent!.notice.subject, /Your 115\.94 EUR is on its way to Anna Schmidt/);
  assert.match(delivered!.notice.subject, /Anna Schmidt has received 115\.94 EUR/);
  assert.match(delivered!.notice.text, /You paid 100\.00 GBP/);
});

test('the transfer being created does not send a message, and nothing is sent twice', async () => {
  const { world, receive, runner, providerId, pollStuckTransfers } = await arrange();
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), [], 'AWAITING_FUNDS is not announced');

  const funded = world.mock.advanceTransfer(providerId, 'funded');
  await receive(funded);
  await receive(funded);
  await runner.drain();
  // Even a second job for the same message sends nothing.
  await world.jobQueue.enqueue({
    type: 'notify_transfer',
    payload: {
      transferId: [...world.transferRepository.transfers.keys()][0],
      kind: 'FUNDS_RECEIVED',
    },
  });
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), ['FUNDS_RECEIVED']);
  void pollStuckTransfers;
});

test('a mail outage is retried, not lost', async () => {
  const { world, receive, runner, providerId } = await arrange();
  world.mailer.failNext = true;
  await receive(world.mock.advanceTransfer(providerId, 'funded'));
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), []);
  const job = world.jobQueue.ofType('notify_transfer')[0]!;
  assert.equal(job.status, 'queued');
  assert.equal(job.lastError, 'mail service unavailable');

  job.runAt = new Date(0);
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), ['FUNDS_RECEIVED']);
});

test('no message goes to a customer whose account is no longer active', async () => {
  const { world, receive, runner, providerId } = await arrange();
  const stored = world.transferRepository.transfers.get(
    [...world.transferRepository.transfers.keys()][0]!,
  )!;
  (stored as { userId: string }).userId = 'closed-account';
  await receive(world.mock.advanceTransfer(providerId, 'funded'));
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), []);
});

// --- Bounce-backs and refunds ---------------------------------------------------------------

test('a payout that fails after funding tells the customer what happens next and is flagged for an admin', async () => {
  const { world, receive, runner, providerId, status } = await arrange();
  await receive(world.mock.advanceTransfer(providerId, 'funded'));
  await receive(world.mock.advanceTransfer(providerId, 'paid_out'));
  await runner.drain();
  assert.deepEqual(world.adminAlerts.kinds(), []);

  await receive(world.mock.advanceTransfer(providerId, 'rejected'));
  await runner.drain();

  assert.equal(await status(), 'FAILED');
  assert.deepEqual(world.adminAlerts.kinds(), ['PAYOUT_FAILED_AFTER_FUNDING']);
  const alert = world.adminAlerts.alerts[0]!;
  assert.equal(alert.severity, 'high');
  assert.equal(alert.context?.fromStatus, 'SENT');
  assert.equal(alert.context?.providerStatus, 'rejected');
  // Identifiers and statuses only: no names or bank details.
  assert.ok(!JSON.stringify(alert).includes('Anna'));
  assert.ok(!JSON.stringify(alert).includes('DE89'));

  const failed = world.mailer.notices.find((n) => n.notice.kind === 'FAILED')!;
  assert.match(failed.notice.subject, /We could not deliver your transfer to Anna Schmidt/);
  assert.match(failed.notice.text, /Your money is not lost/);
  assert.match(failed.notice.text, /will return your 100\.00 GBP to you/);
  assert.match(failed.notice.text, /do not need to do anything/);
});

test('the refund that follows is announced, and a late success after a failure is delivered normally', async () => {
  const { world, receive, runner, providerId, status } = await arrange();
  await receive(world.mock.advanceTransfer(providerId, 'funded'));
  await receive(world.mock.advanceTransfer(providerId, 'rejected'));
  await receive(world.mock.advanceTransfer(providerId, 'returned'));
  await runner.drain();

  assert.equal(await status(), 'REFUNDED');
  assert.deepEqual(world.mailer.kinds(), ['FUNDS_RECEIVED', 'FAILED', 'REFUNDED']);
  assert.deepEqual(world.adminAlerts.kinds(), ['PAYOUT_FAILED_AFTER_FUNDING', 'TRANSFER_REFUNDED']);
  const refunded = world.mailer.notices.at(-1)!;
  assert.match(refunded.notice.text, /sent back the money for your transfer to Anna Schmidt/);
  assert.match(refunded.notice.text, /100\.00 GBP/);
});

test('a transfer that is cancelled before any money was taken is not an alarm', async () => {
  const { world, receive, runner, providerId, status } = await arrange();
  await receive(world.mock.advanceTransfer(providerId, 'cancelled'));
  await runner.drain();
  assert.equal(await status(), 'CANCELLED');
  assert.deepEqual(world.adminAlerts.kinds(), []);
  assert.deepEqual(world.mailer.kinds(), ['CANCELLED']);
  assert.match(world.mailer.notices[0]!.notice.text, /no money has been sent to them/);
});

test('a failure with no money taken yet is told to the customer but is not a funded-payout alert', async () => {
  const { world, receive, runner, providerId } = await arrange();
  await receive(world.mock.advanceTransfer(providerId, 'rejected'));
  await runner.drain();
  assert.deepEqual(world.mailer.kinds(), ['FAILED']);
  assert.deepEqual(world.adminAlerts.kinds(), []);
});
