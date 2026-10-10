import type { ServiceHealth } from '../../domain/health/service-health.ts';

/** Injectable clock/process dependencies, kept minimal for testability. */
export interface HealthDependencies {
  readonly version: string;
  readonly uptimeSeconds: () => number;
  readonly now: () => Date;
}

export type GetServiceHealth = () => ServiceHealth;

/**
 * Builds the use case that reports service health. No I/O today; when real
 * dependency checks (database, Wise reachability) are added they belong here.
 */
export function createGetServiceHealth(deps: HealthDependencies): GetServiceHealth {
  return () => ({
    status: 'ok',
    version: deps.version,
    uptimeSeconds: Math.floor(deps.uptimeSeconds()),
    checkedAt: deps.now(),
  });
}
