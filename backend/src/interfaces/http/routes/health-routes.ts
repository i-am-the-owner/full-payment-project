import { Router } from 'express';
import type { GetServiceHealth } from '../../../application/health/get-service-health.ts';
import type { CheckReadiness } from '../../../application/health/check-readiness.ts';
import { livenessController, readinessController } from '../controllers/health-controller.ts';

/**
 * Infrastructure health probes. These are intentionally unversioned and outside
 * `/api` — they are consumed by orchestrators and load balancers, not clients.
 *
 * `/healthz` – liveness (restart me if this fails)
 * `/readyz`  – readiness (stop routing traffic to me if this fails)
 */
export function healthRoutes(deps: {
  getServiceHealth: GetServiceHealth;
  checkReadiness: CheckReadiness;
}): Router {
  const router = Router();
  router.get('/healthz', livenessController(deps.getServiceHealth));
  router.get('/readyz', readinessController(deps.checkReadiness));
  return router;
}
