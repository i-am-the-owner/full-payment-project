import { Router } from 'express';
import { z } from 'zod';
import type { AccessTokenAuthenticator } from '../../../../application/auth/authenticate-access-token.ts';
import type { GetCurrentUser } from '../../../../application/auth/get-current-user.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validateRequest } from '../../middleware/validate-request.ts';
import { asyncHandler } from '../../middleware/async-handler.ts';
import { requirePrincipal } from '../../require-principal.ts';
import { sendData } from '../../response.ts';

export interface MeRoutesDeps {
  readonly authenticator: AccessTokenAuthenticator;
  readonly getCurrentUser: GetCurrentUser;
}

const noQueryParams = validateRequest({ query: z.strictObject({}) });

/** `GET /api/v1/me` – the authenticated user's own account. */
export function meRoutes(deps: MeRoutesDeps): Router {
  const router = Router();

  router.get(
    '/',
    authenticate(deps.authenticator),
    authorize(),
    noQueryParams,
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const user = await deps.getCurrentUser(principal.userId);
      sendData(res, {
        id: user.id,
        email: user.email,
        status: user.status,
        emailVerified: user.emailVerified,
        roles: principal.roles,
      });
    }),
  );

  return router;
}
