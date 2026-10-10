import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { DependencyCheck } from '../../application/health/check-readiness.ts';
import type { DatabasePool } from './pool.ts';

const CHECK_TIMEOUT_MS = 2_000;

/** A readiness check that runs `SELECT 1` against the connection pool. */
export function databaseCheck(pool: DatabasePool): DependencyCheck {
  return async () => {
    const start = performance.now();
    const timeout = new AbortController();
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        delay(CHECK_TIMEOUT_MS, undefined, { signal: timeout.signal }).then(() => {
          throw new Error('database readiness check timed out');
        }),
      ]);
      return { name: 'database', status: 'up', latencyMs: elapsed(start) };
    } catch {
      return { name: 'database', status: 'down', latencyMs: elapsed(start) };
    } finally {
      timeout.abort();
    }
  };
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}
