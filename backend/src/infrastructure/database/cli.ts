import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createLogger } from '../../shared/logger.ts';
import { createDatabasePool } from './pool.ts';
import { loadMigrations, migrate, rollback, status } from './migrator.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

type Command = 'migrate' | 'rollback' | 'status';

function parseCommand(argv: string[]): Command {
  const command = argv[2];
  if (command === 'migrate' || command === 'rollback' || command === 'status') {
    return command;
  }
  throw new Error(`Usage: cli.ts <migrate|rollback|status>`);
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }
  return url;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  const logger = createLogger({
    level: (process.env.LOG_LEVEL as 'info' | undefined) ?? 'info',
    base: { component: 'db-cli' },
  });

  const migrations = await loadMigrations(MIGRATIONS_DIR);
  const pool = createDatabasePool(requireDatabaseUrl());

  try {
    switch (command) {
      case 'migrate': {
        const applied = await migrate(pool, migrations, logger);
        logger.info('db.migrate.done', { appliedCount: applied.length, applied });
        break;
      }
      case 'rollback': {
        const reverted = await rollback(pool, migrations, logger);
        logger.info('db.rollback.done', { reverted });
        break;
      }
      case 'status': {
        const rows = await status(pool, migrations);
        for (const row of rows) {
          logger.info('db.status.migration', {
            version: row.version,
            name: row.name,
            applied: row.applied,
            appliedAt: row.appliedAt?.toISOString() ?? null,
          });
        }
        break;
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'error', msg: 'db.cli.failed', error: message })}\n`,
  );
  process.exitCode = 1;
});
