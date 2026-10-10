import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiveProviderWebhook } from '../../../../src/application/transfer/receive-provider-webhook.ts';
import { MockPayoutProvider } from '../../../../src/infrastructure/providers/mock/mock-payout-provider.ts';
import { createLogger } from '../../../../src/shared/logger.ts';
import { transferWithWebhooks } from '../../../support/webhook-world.ts';

/**
 * Receiving a webhook is fast and does one thing: verify, record, queue. A
 * background job then applies it. These tests drive both halves.
 */

const MINUTE = 60_000;

async function arrange(options: Parameters<typeof transferWithWebhooks>[0] = {}) {
  const t = await transferWithWebhooks(options);
  /** Receives a webhook, then lets the worker process what was queued. */
  const deliver = async (webhook: Parameters<typeof t.receive>[0]) => {
    const outcome = await t.receive(webhook);
    await t.runner.drain();
    return outcome;
  };
  const events = () => t.world.transferRepository.events.get(t.transfer.id) ?? [];
  return { ...t, deliver, events };
}

// --- Verification, before anything is parsed ----------------------------------

test('a webhook with a bad signature is rejected, logged without its body, and changes nothing', async () => {
  const { world, receive, runner, status, providerId } = await arrange();
  const logLines: string[] = [];
  const logged = createReceiveProviderWebhook({
    provider: world.provider,
    webhookEventRepository: world.webhookEventRepository,
    jobQueue: world.jobQueue,
    auditLog: world.auditLog,
    logger: createLogger({ level: 'debug', write: (_level, line) => logLines.push(line) }),
  });
  const webhook = world.mock.advanceTransfer(providerId);

  // Unsigned, and signed with another secret.
  assert.equal(await logged({ headers: {}, rawBody: webhook.rawBody }), 'invalid_signature');
  const forged = new MockPayoutProvider().signWebhook(JSON.parse(webhook.rawBody.toString()));
  assert.equal(await receive(forged), 'invalid_signature');
  await runner.drain();

  assert.equal(await status(), 'AWAITING_FUNDS');
  assert.equal(world.jobQueue.jobs.length, 0, 'nothing was queued');
  // The attempt is recorded as an unverified delivery: a length and a hash, no content.
  assert.equal(world.webhookEventRepository.unverified.length, 2);
  assert.deepEqual(Object.keys(world.webhookEventRepository.unverified[0]!).sort(), [
    'bodyBytes',
    'bodySha256',
    'provider',
  ]);
  assert.equal(world.webhookEventRepository.rows.length, 0, 'no verified delivery was stored');
  // The log names the attempt but never the body.
  const line = logLines.find((l) => l.includes('provider.webhook.invalid_signature'));
  assert.ok(line);
  assert.ok(
    !line.includes(providerId) && !line.includes('delivered') && !line.includes('transfer_id'),
  );
});

test('the signature is checked before the body is parsed: junk with a bad signature is just rejected', async () => {
  const { world, receive } = await arrange();
  let parsed = false;
  const original = world.mock.parseWebhook.bind(world.mock);
  world.mock.parseWebhook = (body) => {
    parsed = true;
    return original(body);
  };
  assert.equal(
    await receive({ headers: { 'x-mock-signature': 'ab' }, rawBody: Buffer.from('{not json') }),
    'invalid_signature',
  );
  assert.equal(parsed, false);
});

// --- Respond quickly, process in the background ---------------------------------

test('a valid webhook is acknowledged and queued; the status changes only when the worker runs', async () => {
  const { world, receive, runner, status, providerId } = await arrange();
  const outcome = await receive(world.mock.advanceTransfer(providerId));

  assert.equal(outcome, 'received');
  assert.equal(await status(), 'AWAITING_FUNDS', 'nothing was applied in the request');
  assert.equal(world.jobQueue.ofType('process_webhook').length, 1);
  assert.equal(world.webhookEventRepository.rows[0]?.result, undefined);

  await runner.drain();
  assert.equal(await status(), 'PROCESSING');
  assert.equal(world.webhookEventRepository.rows[0]?.result, 'processed');
  assert.ok(world.auditLog.actions().includes('provider.webhook.received'));
});

test('if the job cannot be queued the request fails, so the provider retries', async () => {
  const { world, receive, runner, status, providerId } = await arrange();
  const webhook = world.mock.advanceTransfer(providerId);
  world.jobQueue.failNextEnqueue = true;

  await assert.rejects(receive(webhook), /database unavailable/);
  // Recorded but never queued. The retry joins up with the recorded delivery.
  assert.equal(await receive(webhook), 'duplicate');
  await runner.drain();
  assert.equal(await status(), 'PROCESSING');
  assert.equal(world.jobQueue.ofType('process_webhook').length, 1);
});

// --- Deduplication ----------------------------------------------------------------

test('a duplicate event is acknowledged and does nothing', async () => {
  const { world, deliver, status, providerId } = await arrange();
  const webhook = world.mock.advanceTransfer(providerId);

  assert.equal(await deliver(webhook), 'received');
  assert.equal(await deliver(webhook), 'duplicate');
  assert.equal(
    await deliver({ ...webhook, headers: { ...webhook.headers, 'x-delivery-id': 'b' } }),
    'duplicate',
  );

  assert.equal(await status(), 'PROCESSING');
  assert.equal(world.webhookEventRepository.rows.length, 1);
  assert.equal(world.jobQueue.ofType('process_webhook').length, 1);
  assert.equal(world.auditLog.actions().filter((a) => a === 'transfer.status_changed').length, 1);
  assert.equal(world.jobQueue.ofType('notify_transfer').length, 1);
});

test('the same event re-sent with a different body is still the same event', async () => {
  const { world, deliver, status, providerId } = await arrange();
  const first = world.mock.advanceTransfer(providerId);
  const event = JSON.parse(first.rawBody.toString()) as Record<string, unknown>;
  const resent = world.mock.signWebhook({ ...event, resent: true });

  assert.equal(await deliver(first), 'received');
  assert.equal(await deliver(resent), 'duplicate');
  assert.equal(await status(), 'PROCESSING');
  assert.deepEqual(
    world.webhookEventRepository.rows.map((r) => r.providerEventId),
    [event.event_id],
  );
});

test('a duplicate that arrives before the first has been processed does not queue a second job', async () => {
  const { world, receive, runner, status, providerId } = await arrange();
  const webhook = world.mock.advanceTransfer(providerId);
  assert.equal(await receive(webhook), 'received');
  assert.equal(await receive(webhook), 'duplicate');
  assert.equal(world.jobQueue.ofType('process_webhook').length, 1);
  await runner.drain();
  assert.equal(await status(), 'PROCESSING');
});

// --- Forward only ------------------------------------------------------------------

test('an older event arriving after a newer one does not move the status backwards, but is recorded', async () => {
  const { world, deliver, status, providerId, events } = await arrange();
  const now = Date.now();
  // Funded (earlier), then paid out (later) – delivered in the wrong order.
  const funded = world.mock.simulateTransferEvent(providerId, 'funded', {
    occurredAt: new Date(now - 5 * MINUTE),
  });
  const paidOut = world.mock.simulateTransferEvent(providerId, 'paid_out', {
    occurredAt: new Date(now),
  });

  await deliver(paidOut);
  assert.equal(await status(), 'SENT');
  assert.equal(await deliver(funded), 'received');
  assert.equal(await status(), 'SENT');

  // The late event is on the record, flagged as not applied.
  const ignored = events().filter((e) => !e.applied);
  assert.equal(ignored.length, 1);
  assert.equal(ignored[0]?.status, 'PROCESSING');
  assert.equal(ignored[0]?.source, 'WEBHOOK');
  assert.match(ignored[0]?.reason ?? '', /out_of_order|invalid_transition/);
  assert.deepEqual(
    events()
      .filter((e) => e.applied)
      .map((e) => e.status),
    ['DRAFT', 'AWAITING_FUNDS', 'SENT'],
  );
  assert.equal(world.webhookEventRepository.rows.at(-1)?.result, 'ignored');
});

test('an older event is ignored by time even when its status would be a legal step', async () => {
  const { world, deliver, status, providerId, events } = await arrange();
  const now = Date.now();
  // COMPLETED -> FAILED is a legal step (a chargeback), but this failure is OLDER
  // than the delivery already applied.
  await deliver(
    world.mock.simulateTransferEvent(providerId, 'delivered', { occurredAt: new Date(now) }),
  );
  assert.equal(await status(), 'COMPLETED');
  await deliver(
    world.mock.simulateTransferEvent(providerId, 'rejected', {
      occurredAt: new Date(now - 10 * MINUTE),
    }),
  );
  assert.equal(await status(), 'COMPLETED');
  assert.equal(
    events()
      .filter((e) => !e.applied)
      .at(0)?.reason,
    'out_of_order',
  );
  // And no failure email or admin alert came of it.
  assert.deepEqual(world.adminAlerts.kinds(), []);
  assert.deepEqual(world.mailer.kinds(), ['DELIVERED']);
});

test('a newer event that skips steps is applied (AWAITING_FUNDS straight to COMPLETED)', async () => {
  const { world, deliver, status, providerId } = await arrange();
  await deliver(world.mock.simulateTransferEvent(providerId, 'delivered'));
  assert.equal(await status(), 'COMPLETED');
});

test('an unmapped provider status is recorded as ignored and changes nothing', async () => {
  const { world, deliver, status, providerId } = await arrange();
  const odd = world.mock.signWebhook({
    event: 'transfer.updated',
    event_id: 'evt-odd',
    transfer_id: providerId,
    status: 'on_hold_for_review',
    occurred_at: new Date().toISOString(),
  });
  assert.equal(await deliver(odd), 'received');
  assert.equal(await status(), 'AWAITING_FUNDS');
  assert.equal(world.webhookEventRepository.rows[0]?.note, 'unmapped_status');
  assert.equal(await deliver(world.mock.signWebhook({ event: 'account.updated' })), 'ignored');
});

// --- Unknown transfers --------------------------------------------------------------

test('a webhook for an unknown transfer is retried with backoff before anyone is alerted', async () => {
  const { world, receive, runner } = await arrange();
  await receive(world.mock.simulateTransferEvent('mock-transfer-nobody', 'delivered'));
  const job = world.jobQueue.ofType('process_webhook')[0]!;

  // The real queue waits between attempts; here the wait is skipped.
  for (let attempt = 1; attempt < job.maxAttempts; attempt += 1) {
    job.runAt = new Date(0);
    await runner.drain();
    assert.equal(job.status, 'queued', `attempt ${attempt} is retried later`);
    assert.equal(job.attempts, attempt);
    assert.deepEqual(world.adminAlerts.kinds(), [], 'no alert while it may still arrive');
  }
  assert.ok(job.runAt.getTime() > Date.now(), 'the retry is scheduled in the future');

  job.runAt = new Date(0);
  await runner.drain();
  assert.equal(job.attempts, job.maxAttempts);
  assert.equal(world.webhookEventRepository.rows[0]?.result, 'failed');
  assert.deepEqual(world.adminAlerts.kinds(), ['UNKNOWN_PROVIDER_TRANSFER']);
});

test('an unknown transfer: final attempt records failure and alerts an admin', async () => {
  const { world, receive, runner } = await arrange();
  const stranger = world.mock.simulateTransferEvent('mock-transfer-nobody', 'delivered');
  await receive(stranger);
  const job = world.jobQueue.ofType('process_webhook')[0]!;
  job.maxAttempts = 1; // only the final attempt, so no waiting

  await runner.drain();

  const row = world.webhookEventRepository.rows[0]!;
  assert.equal(row.result, 'failed');
  assert.equal(row.note, 'unknown_transfer');
  assert.equal(job.status, 'done', 'the job completed: this is recorded, not crashed');
  assert.deepEqual(world.adminAlerts.kinds(), ['UNKNOWN_PROVIDER_TRANSFER']);
  const alert = world.adminAlerts.alerts[0]!;
  assert.equal(alert.entityId, 'mock-transfer-nobody');
  assert.equal(alert.severity, 'medium');
});

test('a webhook that beats our own record of the transfer is applied once the transfer is known', async () => {
  const { world, receive, runner, status, providerId, transfer } = await arrange();
  // Our row has not got the provider's id yet: the provider's webhook came first.
  const stored = world.transferRepository.transfers.get(transfer.id)!;
  stored.providerTransferId = undefined;
  stored.provider = undefined;

  await receive(world.mock.advanceTransfer(providerId));
  await runner.drain();
  const job = world.jobQueue.ofType('process_webhook')[0]!;
  assert.equal(job.status, 'queued', 'queued again for a later attempt');
  assert.equal(job.attempts, 1);
  assert.deepEqual(world.adminAlerts.kinds(), [], 'no alert yet: it may still arrive');

  // The create call's answer is saved, and the retry finds the transfer.
  stored.providerTransferId = providerId;
  stored.provider = 'mock';
  job.runAt = new Date(0);
  await runner.drain();
  assert.equal(await status(), 'PROCESSING');
  assert.equal(world.webhookEventRepository.rows[0]?.result, 'processed');
  assert.deepEqual(world.adminAlerts.kinds(), []);
});

// --- Customer (KYC / account) events ----------------------------------------------------

test('a customer status webhook updates the link, from provider data and in order', async () => {
  const { world, deliver } = await arrange();
  const user = 'user-kyc';
  const ref = `mock-pending-${user}`;
  await world.customerLinkStore.saveLink(user, { provider: 'mock', customerRef: ref });
  const now = Date.now();

  // Verified only counts once the identity check has compared the profile.
  await deliver(
    world.mock.simulateCustomerStatus(ref, 'verified', { occurredAt: new Date(now - 4 * MINUTE) }),
  );
  assert.equal(await world.customerLinkStore.status(user, 'mock'), 'PENDING');
  assert.equal(world.webhookEventRepository.rows.at(-1)?.note, 'identity_not_checked');

  await world.customerLinkStore.markIdentityChecked(user, 'mock');
  await deliver(
    world.mock.simulateCustomerStatus(ref, 'verified', { occurredAt: new Date(now - 3 * MINUTE) }),
  );
  assert.equal(await world.customerLinkStore.status(user, 'mock'), 'VERIFIED');
  assert.ok(
    world.auditLog.entries.some((e) => e.action === 'customer.verification_status_recorded'),
  );

  // The provider suspends the customer; an older "verified" arrives afterwards.
  await deliver(
    world.mock.simulateCustomerStatus(ref, 'rejected', { occurredAt: new Date(now - 2 * MINUTE) }),
  );
  assert.equal(await world.customerLinkStore.status(user, 'mock'), 'REJECTED');
  await deliver(
    world.mock.simulateCustomerStatus(ref, 'verified', {
      occurredAt: new Date(now - 3.5 * MINUTE),
    }),
  );
  assert.equal(await world.customerLinkStore.status(user, 'mock'), 'REJECTED');
  assert.equal(world.webhookEventRepository.rows.at(-1)?.note, 'out_of_order');

  await deliver(world.mock.simulateCustomerStatus(ref, 'needs_relink'));
  assert.equal(await world.customerLinkStore.status(user, 'mock'), 'NEEDS_RELINK');
});

test('a customer held for identity review is never released by a webhook', async () => {
  const { world, deliver } = await arrange();
  const user = 'user-held';
  const ref = `mock-pending-${user}`;
  await world.customerLinkStore.saveLink(user, { provider: 'mock', customerRef: ref });
  await world.customerLinkStore.markIdentityChecked(user, 'mock');
  await world.customerLinkStore.flagIdentityMismatch(user, 'mock');

  await deliver(world.mock.simulateCustomerStatus(ref, 'verified'));
  assert.equal(await world.customerLinkStore.status(user, 'mock'), 'REJECTED_PENDING_REVIEW');
  assert.equal(world.webhookEventRepository.rows.at(-1)?.note, 'held_for_review');
});

test('a customer webhook for someone we do not know ends in an admin alert, not a crash', async () => {
  const { world, receive, runner } = await arrange();
  await receive(world.mock.simulateCustomerStatus('mock-pending-ghost', 'verified'));
  world.jobQueue.ofType('process_webhook')[0]!.maxAttempts = 1;
  await runner.drain();
  assert.deepEqual(world.adminAlerts.kinds(), ['UNKNOWN_PROVIDER_CUSTOMER']);
  assert.equal(world.webhookEventRepository.rows[0]?.result, 'failed');
});
