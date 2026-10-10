import type { Job, JobQueue, NewJob } from '../../application/jobs/job-queue.ts';
import type { DatabasePool } from './pool.ts';

interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** The job queue in the application's own database. */
export class PostgresJobQueue implements JobQueue {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  // A job with no explicit time is due at once. The time is cut to the millisecond
  // because workers compare it with a JavaScript clock, which has no finer unit: with
  // microseconds, a worker in the same millisecond would find the job not yet due.
  async enqueue(job: NewJob): Promise<{ id: string; created: boolean }> {
    const { rows } = await this.#pool.query<{ id: string }>(
      `INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts)
       VALUES ($1, $2::jsonb, $3, COALESCE($4, date_trunc('milliseconds', now())), COALESCE($5, 8))
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        job.type,
        JSON.stringify(job.payload ?? {}),
        job.dedupeKey ?? null,
        job.runAt ?? null,
        job.maxAttempts ?? null,
      ],
    );
    if (rows[0]) {
      return { id: rows[0].id, created: true };
    }
    const existing = await this.#pool.query<{ id: string }>(
      `SELECT id FROM jobs WHERE dedupe_key = $1`,
      [job.dedupeKey],
    );
    return { id: existing.rows[0]?.id ?? '', created: false };
  }

  async claim(workerId: string, now: Date): Promise<Job | null> {
    const { rows } = await this.#pool.query<JobRow>(
      `UPDATE jobs SET status = 'running', locked_at = $2, locked_by = $1, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs WHERE status = 'queued' AND run_at <= $2
         ORDER BY run_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, type, payload, attempts, max_attempts`,
      [workerId, now],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          type: row.type,
          payload: row.payload,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
        }
      : null;
  }

  async complete(id: string): Promise<void> {
    await this.#pool.query(
      `UPDATE jobs SET status = 'done', finished_at = now(), locked_at = NULL, locked_by = NULL,
                       last_error = NULL
       WHERE id = $1`,
      [id],
    );
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.#pool.query(
      `UPDATE jobs SET status = CASE WHEN $3::timestamptz IS NULL THEN 'dead' ELSE 'queued' END,
                       run_at = COALESCE($3, run_at),
                       finished_at = CASE WHEN $3::timestamptz IS NULL THEN now() END,
                       locked_at = NULL, locked_by = NULL, last_error = $2
       WHERE id = $1`,
      [id, error, retryAt],
    );
  }

  async releaseStale(lockedBefore: Date): Promise<number> {
    const { rowCount } = await this.#pool.query(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL,
                       last_error = 'worker lost'
       WHERE status = 'running' AND locked_at < $1`,
      [lockedBefore],
    );
    return rowCount ?? 0;
  }

  async prune(before: Date): Promise<number> {
    const { rowCount } = await this.#pool.query(
      `DELETE FROM jobs WHERE status = 'done' AND finished_at < $1`,
      [before],
    );
    return rowCount ?? 0;
  }
}
