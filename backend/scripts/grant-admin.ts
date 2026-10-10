/**
 * Gives or removes a staff role. Admin accounts cannot be created through the API.
 *
 *   node --env-file-if-exists=.env scripts/grant-admin.ts grant  --email <email> [--role admin|support]
 *   node --env-file-if-exists=.env scripts/grant-admin.ts revoke --email <email> [--role admin|support]
 *
 * The person must already have an account. A role only takes effect once they
 * have turned on two-step sign-in (in the app, as any customer would) and sign
 * in again with a code. Every change is written to the audit log. Needs DATABASE_URL.
 */
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createDatabasePool } from '../src/infrastructure/database/pool.ts';
import { PostgresAuditLog } from '../src/infrastructure/database/postgres-audit-log.ts';
import { createLogger } from '../src/shared/logger.ts';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: 'string' }, role: { type: 'string', default: 'admin' } },
  });
  const command = positionals[0];
  const role = values.role;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL.');
  if (!values.email || (command !== 'grant' && command !== 'revoke')) {
    throw new Error('Usage: grant-admin.ts grant|revoke --email <email> [--role admin|support]');
  }
  if (role !== 'admin' && role !== 'support') throw new Error('--role must be admin or support.');

  const pool = createDatabasePool(url, { max: 2, statementTimeoutMs: 30_000 });
  try {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      values.email,
    ]);
    const id = rows[0]?.id;
    if (!id) throw new Error('There is no user with that email.');
    const by = `cli:${userInfo().username}`;
    if (command === 'grant') {
      await pool.query(
        `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, role, by],
      );
    } else {
      await pool.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = $2`, [id, role]);
    }
    // Written strictly: a role change that cannot be recorded is not made.
    await new PostgresAuditLog(pool, createLogger({ level: 'error' })).recordStrict({
      actorType: 'system',
      action: `admin.role.${command === 'grant' ? 'granted' : 'revoked'}`,
      entityType: 'user',
      entityId: id,
      context: { role, by },
    });
    console.log(`${command === 'grant' ? 'Granted' : 'Revoked'} ${role} for ${values.email}.`);
    if (command === 'grant') {
      console.log('They must turn on two-step sign-in and sign in again before it takes effect.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
