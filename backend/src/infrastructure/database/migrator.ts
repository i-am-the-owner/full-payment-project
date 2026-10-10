import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

/**
 * A minimal, plain-SQL migration runner.
 *
 * Each migration is a single `NNNN_snake_name.sql` file containing a
 * `-- migrate:up` section and a `-- migrate:down` section (the dbmate/tern
 * convention, so the files stay portable). Migrations are applied in version
 * order, each inside its own transaction (PostgreSQL has transactional DDL), and
 * recorded in `schema_migrations` with a checksum so accidental edits to an
 * already-applied migration are detected.
 *
 * See docs/architecture/adr/0006-database-and-migrations.md for the rationale.
 */

const MIGRATIONS_TABLE = 'schema_migrations';
const FILE_NAME_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const UP_MARKER = '-- migrate:up';
const DOWN_MARKER = '-- migrate:down';

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly checksum: string;
}

export interface MigrationStatusRow {
  readonly version: string;
  readonly name: string;
  readonly applied: boolean;
  readonly appliedAt: Date | null;
}

export interface MigrationLogger {
  info(message: string, fields?: Record<string, unknown>): void;
}

function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Splits a migration file into its up/down sections. Throws on a malformed file. */
export function parseMigration(fileName: string, content: string): Migration {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    throw new Error(
      `Invalid migration file name "${fileName}". Expected "NNNN_snake_case_name.sql".`,
    );
  }
  const [, version, name] = match as unknown as [string, string, string];

  const upIndex = content.indexOf(UP_MARKER);
  const downIndex = content.indexOf(DOWN_MARKER);
  if (upIndex === -1 || downIndex === -1 || downIndex < upIndex) {
    throw new Error(
      `Migration "${fileName}" must contain "${UP_MARKER}" then "${DOWN_MARKER}" markers.`,
    );
  }

  const up = content.slice(upIndex + UP_MARKER.length, downIndex).trim();
  const down = content.slice(downIndex + DOWN_MARKER.length).trim();
  if (up.length === 0) {
    throw new Error(`Migration "${fileName}" has an empty up section.`);
  }

  return { version, name, up, down, checksum: checksum(content) };
}

/** Loads and validates all migrations in a directory, sorted by version. */
export async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = (await readdir(directory)).filter((file) => file.endsWith('.sql'));

  const migrations = await Promise.all(
    entries.map(async (file) =>
      parseMigration(file, await readFile(join(directory, file), 'utf8')),
    ),
  );

  migrations.sort((a, b) => a.version.localeCompare(b.version));

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version "${migration.version}".`);
    }
    seen.add(migration.version);
  }

  return migrations;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

async function fetchApplied(client: PoolClient): Promise<Map<string, AppliedRow>> {
  const result = await client.query<AppliedRow>(
    `SELECT version, name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`,
  );
  return new Map(result.rows.map((row) => [row.version, row]));
}

function assertNoChecksumDrift(migration: Migration, applied: AppliedRow): void {
  if (applied.checksum !== migration.checksum) {
    throw new Error(
      `Migration "${migration.version}_${migration.name}" was modified after being applied. ` +
        `Create a new migration instead of editing an applied one.`,
    );
  }
}

/** Applies every migration not yet recorded in `schema_migrations`. */
export async function migrate(
  pool: Pool,
  migrations: Migration[],
  logger: MigrationLogger,
): Promise<string[]> {
  const client = await pool.connect();
  const appliedVersions: string[] = [];
  try {
    await ensureMigrationsTable(client);
    const applied = await fetchApplied(client);

    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing) {
        assertNoChecksumDrift(migration, existing);
        continue;
      }

      logger.info('db.migrate.applying', { version: migration.version, name: migration.name });
      try {
        await client.query('BEGIN');
        await client.query(migration.up);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      appliedVersions.push(migration.version);
    }
  } finally {
    client.release();
  }
  return appliedVersions;
}

/** Reverts the most recently applied migration using its down section. */
export async function rollback(
  pool: Pool,
  migrations: Migration[],
  logger: MigrationLogger,
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await fetchApplied(client);
    if (applied.size === 0) {
      return null;
    }

    const lastVersion = [...applied.keys()].sort().at(-1);
    const migration = migrations.find((candidate) => candidate.version === lastVersion);
    if (!migration) {
      throw new Error(`Cannot roll back "${lastVersion ?? ''}": its migration file is missing.`);
    }
    if (migration.down.length === 0) {
      throw new Error(`Migration "${migration.version}_${migration.name}" has no down section.`);
    }

    logger.info('db.rollback.reverting', { version: migration.version, name: migration.name });
    try {
      await client.query('BEGIN');
      await client.query(migration.down);
      await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = $1`, [migration.version]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return migration.version;
  } finally {
    client.release();
  }
}

/** Returns the applied/pending state of every known migration. */
export async function status(pool: Pool, migrations: Migration[]): Promise<MigrationStatusRow[]> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await fetchApplied(client);
    return migrations.map((migration) => {
      const row = applied.get(migration.version);
      return {
        version: migration.version,
        name: migration.name,
        applied: row !== undefined,
        appliedAt: row?.applied_at ?? null,
      };
    });
  } finally {
    client.release();
  }
}
