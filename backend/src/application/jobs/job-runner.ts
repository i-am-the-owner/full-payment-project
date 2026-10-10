import type { Logger } from '../../shared/logger.ts';
import type { AdminAlerts } from '../notifications/admin-alerts.ts';
import type { Job, JobQueue } from './job-queue.ts';

export interface JobContext {
  /** 1 on the first attempt. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** True when a failure now parks the job instead of retrying it. */
  readonly isLastAttempt: boolean;
}

export type JobHandler = (
  payload: Readonly<Record<string, unknown>>,
  context: JobContext,
) => Promise<void>;

export interface JobRunnerDeps {
  readonly queue: JobQueue;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly adminAlerts: AdminAlerts;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly workerId: string;
  /** First retry delay; doubles each attempt, capped at one hour. */
  readonly backoffBaseMs?: number;
  /** A running job locked longer than this is assumed lost and re-queued. */
  readonly staleAfterMs?: number;
}

export interface JobRunner {
  /** Runs one due job. False when there was none. */
  runOnce(): Promise<boolean>;
  /** Runs due jobs until none are left (or `max`). For tests and dev tools. */
  drain(max?: number): Promise<number>;
  start(pollIntervalMs: number): void;
  stop(): Promise<void>;
}

const HOUR_MS = 60 * 60 * 1000;

export function createJobRunner(deps: JobRunnerDeps): JobRunner {
  const base = deps.backoffBaseMs ?? 15_000;
  const staleAfter = deps.staleAfterMs ?? 5 * 60_000;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let ticking = false;

  const retryAt = (job: Job): Date | null =>
    job.attempts >= job.maxAttempts
      ? null
      : new Date(deps.clock().getTime() + Math.min(base * 2 ** (job.attempts - 1), HOUR_MS));

  const handle = async (job: Job): Promise<void> => {
    const handler = deps.handlers[job.type];
    try {
      if (!handler) {
        throw new Error(`No handler for job type "${job.type}"`);
      }
      await handler(job.payload, {
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        isLastAttempt: job.attempts >= job.maxAttempts,
      });
      await deps.queue.complete(job.id);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      const next = handler ? retryAt(job) : null;
      await deps.queue.fail(job.id, message, next);
      if (next) {
        deps.logger.warn('job.retry', {
          jobId: job.id,
          type: job.type,
          attempt: job.attempts,
          retryAt: next.toISOString(),
          error: message,
        });
        return;
      }
      deps.logger.error('job.dead', { jobId: job.id, type: job.type, attempts: job.attempts });
      try {
        await deps.adminAlerts.raise({
          kind: 'JOB_FAILED',
          severity: 'high',
          entityType: 'job',
          entityId: job.id,
          message: `A background job (${job.type}) failed ${job.attempts} time(s) and was given up on.`,
          context: { jobType: job.type, attempts: job.attempts },
        });
      } catch {
        // The log line above is the fallback.
      }
    }
  };

  const runOnce = async (): Promise<boolean> => {
    const job = await deps.queue.claim(deps.workerId, deps.clock());
    if (!job) {
      return false;
    }
    await handle(job);
    return true;
  };

  const drain = async (max = 200): Promise<number> => {
    let ran = 0;
    while (ran < max && (await runOnce())) {
      ran += 1;
    }
    return ran;
  };

  const tick = async (): Promise<void> => {
    if (ticking) {
      return;
    }
    ticking = true;
    try {
      await deps.queue.releaseStale(new Date(deps.clock().getTime() - staleAfter));
      await drain(25);
    } catch (error) {
      deps.logger.error('job.runner.error', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      ticking = false;
    }
  };

  return {
    runOnce,
    drain,
    start(pollIntervalMs) {
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        inFlight = tick();
      }, pollIntervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}

export interface ScheduledTask {
  readonly type: string;
  readonly everyMs: number;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Enqueues recurring jobs. Each run of a task has a key built from the time
 * bucket it falls in, so any number of instances ticking at once still enqueue
 * it exactly once per period.
 */
export function createScheduler(deps: {
  queue: JobQueue;
  tasks: readonly ScheduledTask[];
  clock: () => Date;
  logger: Logger;
}): { tick(): Promise<void>; start(everyMs: number): void; stop(): void } {
  let timer: NodeJS.Timeout | undefined;
  const tick = async (): Promise<void> => {
    const now = deps.clock();
    for (const task of deps.tasks) {
      const bucket = Math.floor(now.getTime() / task.everyMs);
      try {
        await deps.queue.enqueue({
          type: task.type,
          payload: task.payload,
          dedupeKey: `schedule:${task.type}:${bucket}`,
          maxAttempts: 3,
        });
      } catch (error) {
        deps.logger.error('job.schedule.error', {
          type: task.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Old finished jobs are not kept forever.
    await deps.queue.prune(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)).catch(() => 0);
  };
  return {
    tick,
    start(everyMs) {
      if (timer) {
        return;
      }
      void tick();
      timer = setInterval(() => void tick(), everyMs);
      timer.unref();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
