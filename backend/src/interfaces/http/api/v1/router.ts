import { Router } from 'express';
import { sensitiveRateLimiter } from '../../middleware/rate-limit.ts';
import { meRoutes, type MeRoutesDeps } from './me-routes.ts';
import { adminRoutes, type AdminRoutesDeps } from './admin-routes.ts';
import { authRoutes, type AuthRoutesDeps } from './auth-routes.ts';
import { sendMoneyRoutes, type SendMoneyRoutesDeps } from './send-money-routes.ts';
import { onboardingRoutes, type OnboardingRoutesDeps } from './onboarding-routes.ts';

export type V1RouterDeps = MeRoutesDeps &
  AdminRoutesDeps &
  AuthRoutesDeps &
  SendMoneyRoutesDeps &
  OnboardingRoutesDeps;

/** Everything mounted under `/api/v1`. */
export function v1Router(deps: V1RouterDeps): Router {
  const router = Router();

  router.use('/auth', authRoutes(deps));
  router.use('/me', meRoutes(deps));
  router.use('/admin', sensitiveRateLimiter(deps.rateLimit), adminRoutes(deps));
  router.use(onboardingRoutes(deps));
  router.use(sendMoneyRoutes(deps));

  return router;
}
