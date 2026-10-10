import { Router } from 'express';
import type { AdminAccessStore } from '../../../../application/admin/admin-access.ts';
import type { StrictAuditLog } from '../../../../application/audit/audit-log.ts';
import { adminGate } from '../../middleware/admin-gate.ts';
import { adminConsoleRoutes, type AdminConsoleDeps } from './admin-console-routes.ts';
import { z } from 'zod';
import type { AccessTokenAuthenticator } from '../../../../application/auth/authenticate-access-token.ts';
import type { ManageUserAccounts } from '../../../../application/admin/manage-user-accounts.ts';
import type { AdminAlerts } from '../../../../application/notifications/admin-alerts.ts';
import { NotFoundError } from '../../../../shared/errors.ts';
import { asyncHandler } from '../../middleware/async-handler.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validateRequest } from '../../middleware/validate-request.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../validated-input.ts';
import { requirePrincipal } from '../../require-principal.ts';
import { sendData } from '../../response.ts';

export interface AdminRoutesDeps extends AdminConsoleDeps {
  readonly adminAccess: AdminAccessStore;
  readonly strictAuditLog: StrictAuditLog;
  readonly authenticator: AccessTokenAuthenticator;
  readonly adminAlerts: AdminAlerts;
  readonly manageUserAccounts: ManageUserAccounts;
}

/**
 * Admin-only diagnostics. Exists to exercise the authorization foundation;
 * real admin operations are added in later milestones and reuse `authorize`.
 */
export function adminRoutes(deps: AdminRoutesDeps): Router {
  const router = Router();

  // Every admin endpoint: a valid session, the admin role, two-step sign-in
  // still on, and an audit record written before anything is shown or done.
  router.use(
    authenticate(deps.authenticator),
    authorize('admin'),
    adminGate({ access: deps.adminAccess, auditLog: deps.strictAuditLog }),
  );

  router.get('/whoami', validateRequest({ query: z.strictObject({}) }), (req, res) => {
    const principal = requirePrincipal(req);
    sendData(res, {
      userId: principal.userId,
      roles: principal.roles,
      tokenId: principal.tokenId,
    });
  });

  // Things that need a person: a payout that failed after the customer's money
  // was taken, a provider event for a transfer we do not know, a job that gave up.
  router.get(
    '/alerts',
    validateRequest({
      query: z.strictObject({
        status: z.enum(['open', 'resolved', 'all']).default('open'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    }),
    asyncHandler(async (req, res) => {
      const query = validatedQuery<{ status: 'open' | 'resolved' | 'all'; limit: number }>(req);
      const alerts = await deps.adminAlerts.list(query);
      sendData(res, {
        alerts: alerts.map((a) => ({
          id: a.id,
          kind: a.kind,
          severity: a.severity,
          entityType: a.entityType,
          entityId: a.entityId,
          message: a.message,
          context: a.context ?? {},
          status: a.status,
          occurrences: a.occurrences,
          firstSeenAt: a.firstSeenAt.toISOString(),
          lastSeenAt: a.lastSeenAt.toISOString(),
          resolvedAt: a.resolvedAt?.toISOString() ?? null,
        })),
      });
    }),
  );

  router.post(
    '/alerts/:id/resolve',
    validateRequest({ params: z.strictObject({ id: z.uuid() }), body: z.strictObject({}) }),
    asyncHandler(async (req, res) => {
      const ok = await deps.adminAlerts.resolve(
        validatedParams<{ id: string }>(req).id,
        requirePrincipal(req).userId,
      );
      if (!ok) {
        throw new NotFoundError('There is no open alert with that id.');
      }
      sendData(res, { status: 'resolved' });
    }),
  );

  // Suspending takes effect on the user's next request: sending stops at once.
  router.post(
    '/users/:id/suspend',
    validateRequest({
      params: z.strictObject({ id: z.uuid() }),
      body: z.strictObject({ reason: z.string().trim().min(3).max(200) }),
    }),
    asyncHandler(async (req, res) => {
      await deps.manageUserAccounts.suspend({
        adminUserId: requirePrincipal(req).userId,
        userId: validatedParams<{ id: string }>(req).id,
        reason: validatedBody<{ reason: string }>(req).reason,
      });
      sendData(res, { status: 'suspended' });
    }),
  );

  router.post(
    ['/users/:id/reinstate', '/users/:id/unsuspend'],
    validateRequest({ params: z.strictObject({ id: z.uuid() }), body: z.strictObject({}) }),
    asyncHandler(async (req, res) => {
      await deps.manageUserAccounts.reinstate({
        adminUserId: requirePrincipal(req).userId,
        userId: validatedParams<{ id: string }>(req).id,
      });
      sendData(res, { status: 'active' });
    }),
  );

  router.use(adminConsoleRoutes(deps));

  return router;
}
