import { hashSecretToken } from '../../shared/secret-token.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { SessionService } from './session-service.ts';
import type { SessionStore } from './session-store.ts';

export interface LogoutDeps {
  readonly sessionService: SessionService;
  readonly sessionStore: SessionStore;
  readonly auditLog: AuditLog;
}

export type Logout = (input: {
  sessionId?: string | undefined;
  refreshToken?: string | undefined;
  actorId?: string | undefined;
  requestId?: string | undefined;
}) => Promise<void>;

/** Idempotent: revokes the session behind the access token and/or the given refresh token. */
export function createLogout(deps: LogoutDeps): Logout {
  return async ({ sessionId, refreshToken, actorId, requestId }) => {
    if (sessionId) {
      await deps.sessionService.endSession(sessionId, 'logout');
    }

    if (refreshToken) {
      const record = await deps.sessionStore.findByRefreshTokenHash(hashSecretToken(refreshToken));
      if (record && record.id !== sessionId) {
        await deps.sessionService.endSession(record.id, 'logout');
      }
    }

    if (actorId) {
      await deps.auditLog.record({
        actorType: 'user',
        actorId,
        action: 'auth.logout',
        entityType: 'user',
        entityId: actorId,
        requestId,
      });
    }
  };
}

export type LogoutAll = (userId: string, requestId?: string) => Promise<void>;

export function createLogoutAll(deps: Pick<LogoutDeps, 'sessionService' | 'auditLog'>): LogoutAll {
  return async (userId, requestId) => {
    const revoked = await deps.sessionService.endAllSessions(userId, 'logout_all');
    await deps.auditLog.record({
      actorType: 'user',
      actorId: userId,
      action: 'auth.logout_all',
      entityType: 'user',
      entityId: userId,
      context: { revokedSessions: revoked },
      requestId,
    });
  };
}
