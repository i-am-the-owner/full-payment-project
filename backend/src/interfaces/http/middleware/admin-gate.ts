import type { RequestHandler } from 'express';
import type { AdminAccessStore } from '../../../application/admin/admin-access.ts';
import type { StrictAuditLog } from '../../../application/audit/audit-log.ts';
import { AppError, ForbiddenError, UnauthorizedError } from '../../../shared/errors.ts';
import '../express-augmentation.ts';

const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The caller is an admin but has not turned on two-step sign-in. */
export class AdminTwoFactorRequiredError extends AppError {
  constructor() {
    super(
      'ADMIN_2FA_REQUIRED',
      403,
      'Admin access needs two-step sign-in. Turn it on, then sign in again.',
    );
  }
}

/**
 * Guards every admin endpoint. Must run after `authenticate`.
 *
 * The token's role is not trusted on its own. On EVERY request the database is
 * asked whether the person still holds the admin role AND still has two-step
 * sign-in turned on, so removing either takes effect immediately, not when the
 * token expires.
 */
export function adminGate(deps: {
  access: AdminAccessStore;
  auditLog: StrictAuditLog;
}): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const principal = req.auth;
      if (!principal) {
        throw new UnauthorizedError();
      }
      const access = await deps.access.get(principal.userId);
      if (!principal.roles.includes('admin') || !access.roles.includes('admin')) {
        req.log.warn('admin.access_denied', { reason: 'not_admin' });
        throw new ForbiddenError();
      }
      if (!access.twoFactorEnabled) {
        req.log.warn('admin.access_denied', { reason: 'two_factor_not_enabled' });
        throw new AdminTwoFactorRequiredError();
      }

      // Recorded BEFORE the action. If the record cannot be written the request
      // fails and nothing is shown or changed. The search text itself is not
      // recorded (it may be an email address), only that one was used.
      // The gate runs before the route is matched, so the id is read from the path.
      const entityId = UUID_IN_PATH.exec(req.path)?.[0] ?? 'list';
      const query = (req.query ?? {}) as Record<string, unknown>;
      const { q, ...filters } = query;
      await deps.auditLog.recordStrict({
        actorType: 'admin',
        actorId: principal.userId,
        action: `admin.${req.method === 'GET' ? 'view' : 'action'}`,
        entityType: 'admin_console',
        entityId,
        context: {
          method: req.method,
          path: req.baseUrl + req.path,
          filters,
          ...(typeof q === 'string' ? { searchTextLength: q.length } : {}),
        },
        requestId: req.id,
        ipAddress: req.ip,
      });
      next();
    })().catch(next);
  };
}
