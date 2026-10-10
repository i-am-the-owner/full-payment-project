import express, { type Express } from 'express';
import type { AppConfig } from '../../config/app-config.ts';
import type { ErrorReporter } from '../../shared/error-reporter.ts';
import type { Logger } from '../../shared/logger.ts';
import type { GetServiceHealth } from '../../application/health/get-service-health.ts';
import type { CheckReadiness } from '../../application/health/check-readiness.ts';
import { requestContext } from './middleware/request-context.ts';
import { securityHeaders } from './middleware/security-headers.ts';
import { requireHttps } from './middleware/require-https.ts';
import { cors } from './middleware/cors.ts';
import { globalRateLimiter, webhookRateLimiter } from './middleware/rate-limit.ts';
import { notFoundHandler } from './middleware/not-found-handler.ts';
import { createErrorHandler } from './middleware/error-handler.ts';
import { adminConsoleStatic } from './routes/admin-console-static.ts';
import { healthRoutes } from './routes/health-routes.ts';
import { apiRouter, type ApiRouterDeps } from './api/router.ts';
import {
  providerWebhookRoutes,
  type ProviderWebhookRoutesDeps,
} from './webhooks/provider-webhook-routes.ts';
import { mockProviderRoutes, type MockProviderRoutesDeps } from './dev/mock-provider-routes.ts';

export type HttpDependencies = ApiRouterDeps & {
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Receives unexpected (500) errors. */
  readonly errorReporter: ErrorReporter;
  readonly getServiceHealth: GetServiceHealth;
  readonly checkReadiness: CheckReadiness;
  readonly providerWebhooks: ProviderWebhookRoutesDeps;
  /** Present only when the mock provider is active outside production. */
  readonly mockProviderDev: MockProviderRoutesDeps | undefined;
};

const JSON_BODY_LIMIT = '32kb';

/** Assembles the Express application. Pure wiring – no side effects. */
export function createApp(deps: HttpDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.httpSecurity.trustProxy ? 1 : false);
  app.set('query parser', 'simple');

  // Cross-cutting request pipeline.
  app.use(securityHeaders(deps.config.httpSecurity));
  // The request logger comes first: the error handler needs `req.log` even when
  // the HTTPS check below refuses a request.
  app.use(requestContext(deps.logger));
  app.use(requireHttps(deps.config.httpSecurity.requireHttps));

  // Infra probes: unversioned, no body parsing, not rate limited.
  app.use(healthRoutes(deps));

  // The static admin console page (no data of its own; the admin API guards everything).
  if (deps.config.admin.consoleEnabled) {
    app.use('/admin-console', adminConsoleStatic());
  }

  // Provider webhooks: raw body (for signature verification), before the JSON
  // parser, and rate limited on their own generous budget.
  app.use(
    '/webhooks',
    webhookRateLimiter(deps.rateLimit),
    providerWebhookRoutes(deps.providerWebhooks),
  );

  // Strict CORS for the JSON API: no browser origin is allowed unless listed.
  app.use(cors(deps.config.corsAllowedOrigins));

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(globalRateLimiter(deps.rateLimit));

  if (deps.mockProviderDev) {
    app.use('/dev/mock', mockProviderRoutes(deps.mockProviderDev));
  }

  app.use('/api', apiRouter(deps));

  app.use(notFoundHandler());
  app.use(createErrorHandler(deps.errorReporter));

  return app;
}
