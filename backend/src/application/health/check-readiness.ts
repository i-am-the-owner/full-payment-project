import type { DependencyStatus, ReadinessReport } from '../../domain/health/readiness.ts';

export type DependencyCheck = () => Promise<DependencyStatus>;

export type CheckReadiness = () => Promise<ReadinessReport>;

/**
 * Runs every dependency check in parallel and reports the service ready only if
 * they all pass.
 */
export function createCheckReadiness(checks: readonly DependencyCheck[]): CheckReadiness {
  return async () => {
    const results = await Promise.all(checks.map((check) => check()));
    const status = results.every((result) => result.status === 'up') ? 'ready' : 'not_ready';
    return { status, checks: results };
  };
}
