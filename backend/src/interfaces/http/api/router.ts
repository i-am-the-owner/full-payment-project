import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate-request.ts';
import { sendData } from '../response.ts';
import { v1Router, type V1RouterDeps } from './v1/router.ts';

export type ApiRouterDeps = V1RouterDeps;

/**
 * The versioned API. Versioning strategy: URL path (`/api/v{n}`). A new major
 * version is introduced only for breaking changes; additive changes stay within
 * the current version. See docs/api/README.md.
 */
export function apiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  router.get('/', validateRequest({ query: z.strictObject({}) }), (_req, res) => {
    sendData(res, {
      versions: [{ version: 'v1', status: 'current', basePath: '/api/v1' }],
    });
  });

  router.use('/v1', v1Router(deps));

  return router;
}
