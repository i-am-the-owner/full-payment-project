/**
 * Domain model for the service's own health.
 *
 * This is intentionally the only domain concept in Milestone 1: it exercises
 * the layering (domain → application → interface) without introducing any
 * financial logic.
 */

export type ServiceStatus = 'ok';

export interface ServiceHealth {
  readonly status: ServiceStatus;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly checkedAt: Date;
}
