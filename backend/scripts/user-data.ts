/**
 * UK GDPR requests: export everything held about a person, or erase them.
 *
 *   node --env-file-if-exists=.env scripts/user-data.ts export --user <email|id> [--out file.json]
 *   node --env-file-if-exists=.env scripts/user-data.ts erase  --user <email|id> --confirm <the account's email> [--scrub-audit-ips]
 *
 * export  writes a JSON file (or stdout). It never includes credentials.
 * erase   anonymises the account and removes what AlmaPay does not have to
 *         keep. Transfer records are RETAINED (five-year financial record
 *         rule). It refuses while any transfer is unfinished, and needs the
 *         account's email typed again as confirmation.
 *
 * Needs DATABASE_URL. Run it from a secure machine: the export holds personal data.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createUserDataService } from '../src/application/privacy/user-data.ts';
import { createDatabasePool } from '../src/infrastructure/database/pool.ts';
import { PostgresAuditLog } from '../src/infrastructure/database/postgres-audit-log.ts';
import { createLogger } from '../src/shared/logger.ts';
import { PostgresUserData } from '../src/infrastructure/database/postgres-user-data.ts';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      user: { type: 'string' },
      out: { type: 'string' },
      confirm: { type: 'string' },
      'scrub-audit-ips': { type: 'boolean', default: false },
    },
  });
  const command = positionals[0];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL.');
  if (!values.user || (command !== 'export' && command !== 'erase')) {
    throw new Error('Usage: user-data.ts export|erase --user <email|id> [...]');
  }

  const pool = createDatabasePool(url, { max: 2, statementTimeoutMs: 60_000 });
  try {
    const service = createUserDataService({
      repository: new PostgresUserData(pool),
      auditLog: new PostgresAuditLog(pool, createLogger({ level: 'error' })),
      clock: () => new Date(),
    });
    if (command === 'export') {
      const json = `${JSON.stringify(await service.export(values.user), null, 2)}\n`;
      if (values.out) {
        writeFileSync(values.out, json, { mode: 0o600 });
        console.log(`Written to ${values.out} (owner-only permissions).`);
      } else {
        process.stdout.write(json);
      }
      return;
    }
    if (!values.confirm) {
      throw new Error("Erasing is permanent. Add --confirm <the account's email> to go ahead.");
    }
    const report = await service.erase(values.user, {
      confirmEmail: values.confirm,
      scrubAuditIpAddresses: values['scrub-audit-ips'],
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
