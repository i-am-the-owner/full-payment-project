import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobRunner, createScheduler } from '../../../../src/application/jobs/job-runner.ts';
import { FakeAdminAlerts, FakeJobQueue } from '../../../support/transfer-fakes.ts';
import { silentLogger } from '../../../support/webhook-world.ts';

function arrange(handlers: Parameters<typeof createJobRunner>[0]['handlers']) {
  const clock = { now: new Date('2026-10-03T10:00:00Z') };
  const queue = new FakeJobQueue();
  const alerts = new FakeAdminAlerts();
  const runner = createJobRunner({
    queue,
    handlers,
    adminAlerts: alerts,
    logger: silentLogger,
    clock: () => clock.now,
    workerId: 'w',
    backoffBaseMs: 1000,
  });
  return { clock, queue, alerts, runner };
}

test('a job runs once and is marked done', async () => {
  const seen: unknown[] = [];
  const { queue, runner } = arrange({
    hello: (payload) => Promise.resolve(void seen.push(payload)),
  });
  await queue.enqueue({ type: 'hello', payload: { n: 1 } });
  assert.equal(await runner.drain(), 1);
  assert.deepEqual(seen, [{ n: 1 }]);
  assert.equal(queue.jobs[0]?.status, 'done');
  assert.equal(await runner.runOnce(), false);
});

test('a failing job is retried with doubling backoff, then parked and reported', async () => {
  const { clock, queue, alerts, runner } = arrange({
    boom: () => Promise.reject(new Error('still broken')),
  });
  await queue.enqueue({ type: 'boom', maxAttempts: 3 });
  const job = queue.jobs[0]!;

  await runner.drain();
  assert.equal(job.status, 'queued');
  assert.equal(job.runAt.getTime() - clock.now.getTime(), 1000);
  assert.equal(await runner.runOnce(), false, 'not due yet');

  clock.now = new Date(job.runAt.getTime());
  await runner.drain();
  assert.equal(job.runAt.getTime() - clock.now.getTime(), 2000);

  clock.now = new Date(job.runAt.getTime());
  await runner.drain();
  assert.equal(job.status, 'dead');
  assert.equal(job.attempts, 3);
  assert.equal(job.lastError, 'still broken');
  assert.deepEqual(alerts.kinds(), ['JOB_FAILED']);
});

test('a job type nobody handles is parked at once and reported', async () => {
  const { queue, alerts, runner } = arrange({});
  await queue.enqueue({ type: 'mystery' });
  await runner.drain();
  assert.equal(queue.jobs[0]?.status, 'dead');
  assert.deepEqual(alerts.kinds(), ['JOB_FAILED']);
});

test('one failing job does not stop the others', async () => {
  const done: string[] = [];
  const { queue, runner } = arrange({
    bad: () => Promise.reject(new Error('x')),
    good: () => Promise.resolve(void done.push('good')),
  });
  await queue.enqueue({ type: 'bad' });
  await queue.enqueue({ type: 'good' });
  await runner.drain();
  assert.deepEqual(done, ['good']);
});

test('enqueueing with the same key twice makes one job', async () => {
  const queue = new FakeJobQueue();
  const first = await queue.enqueue({ type: 't', dedupeKey: 'k' });
  const second = await queue.enqueue({ type: 't', dedupeKey: 'k' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  assert.equal(queue.jobs.length, 1);
});

test('the scheduler enqueues a recurring job once per period, however often it ticks', async () => {
  const clock = { now: new Date('2026-10-03T10:00:00Z') };
  const queue = new FakeJobQueue();
  const scheduler = createScheduler({
    queue,
    clock: () => clock.now,
    logger: silentLogger,
    tasks: [{ type: 'poll', everyMs: 15 * 60_000 }],
  });

  await scheduler.tick();
  await scheduler.tick();
  clock.now = new Date(clock.now.getTime() + 5 * 60_000);
  await scheduler.tick();
  assert.equal(queue.jobs.length, 1);

  clock.now = new Date(clock.now.getTime() + 10 * 60_000); // 10:15
  await scheduler.tick();
  assert.equal(queue.jobs.length, 2);
});
