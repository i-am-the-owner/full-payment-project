export interface Job {
  readonly id: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Counts this run: 1 on the first attempt. */
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface NewJob {
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  /** Enqueueing a job with a key that already exists does nothing. */
  readonly dedupeKey?: string | undefined;
  readonly runAt?: Date | undefined;
  readonly maxAttempts?: number | undefined;
}

/**
 * A small reliable queue. Jobs survive a restart (they live in the database),
 * are retried with backoff and, after their last attempt, are parked as `dead`
 * rather than lost.
 */
export interface JobQueue {
  /** `created` is false when `dedupeKey` matched an existing job. */
  enqueue(job: NewJob): Promise<{ id: string; created: boolean }>;
  /** Takes the next due job, or null. Safe to call from several workers at once. */
  claim(workerId: string, now: Date): Promise<Job | null>;
  complete(id: string): Promise<void>;
  /** Puts the job back to run at `retryAt`, or parks it as dead when null. */
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
  /** Gives jobs a worker died holding back to the queue. Returns how many. */
  releaseStale(lockedBefore: Date): Promise<number>;
  /** Deletes finished jobs older than `before`. Returns how many. */
  prune(before: Date): Promise<number>;
}
