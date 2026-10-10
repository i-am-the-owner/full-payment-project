import type { RequestHandler } from 'express';
import type { GetServiceHealth } from '../../../application/health/get-service-health.ts';
import type { CheckReadiness } from '../../../application/health/check-readiness.ts';
import { ServiceUnavailableError } from '../../../shared/errors.ts';
import { asyncHandler } from '../middleware/async-handler.ts';
import { sendData } from '../response.ts';

/** Liveness: the process is up and serving. Always 200 when reachable. */
export function livenessController(getServiceHealth: GetServiceHealth): RequestHandler {
  return (_req, res) => {
    const health = getServiceHealth();
    sendData(res, {
      status: health.status,
      version: health.version,
      uptimeSeconds: health.uptimeSeconds,
    });
  };
}

/** Readiness: dependencies are reachable. 200 when ready, 503 otherwise. */
export function readinessController(checkReadiness: CheckReadiness): RequestHandler {
  return asyncHandler(async (_req, res) => {
    const report = await checkReadiness();

    if (report.status !== 'ready') {
      const down = report.checks
        .filter((check) => check.status !== 'up')
        .map((check) => ({ field: check.name, message: 'unavailable' }));
      throw new ServiceUnavailableError('One or more dependencies are unavailable.', down);
    }

    sendData(res, { status: 'ready', checks: report.checks });
  });
}
