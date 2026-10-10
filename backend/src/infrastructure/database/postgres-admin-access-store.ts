import type { AdminAccess, AdminAccessStore } from '../../application/admin/admin-access.ts';
import { isRole, type Role } from '../../domain/auth/principal.ts';
import type { DatabasePool } from './pool.ts';

export class PostgresAdminAccessStore implements AdminAccessStore {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async get(userId: string): Promise<AdminAccess> {
    const { rows } = await this.#pool.query<{ roles: string[]; two_factor: boolean }>(
      `SELECT COALESCE(
                (SELECT array_agg(role) FROM user_roles WHERE user_id = $1), '{}') AS roles,
              COALESCE(
                (SELECT totp_enabled_at IS NOT NULL FROM user_auth WHERE user_id = $1),
                false) AS two_factor`,
      [userId],
    );
    const row = rows[0];
    const roles: Role[] = (row?.roles ?? []).filter(isRole);
    return { roles, twoFactorEnabled: row?.two_factor ?? false };
  }
}
