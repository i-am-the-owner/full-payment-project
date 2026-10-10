import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseMigration,
  loadMigrations,
} from '../../../../src/infrastructure/database/migrator.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../migrations');

test('parseMigration splits the up and down sections', () => {
  const migration = parseMigration(
    '0009_example_change.sql',
    '-- migrate:up\nCREATE TABLE example ();\n-- migrate:down\nDROP TABLE example;\n',
  );

  assert.equal(migration.version, '0009');
  assert.equal(migration.name, 'example_change');
  assert.equal(migration.up, 'CREATE TABLE example ();');
  assert.equal(migration.down, 'DROP TABLE example;');
  assert.match(migration.checksum, /^[a-f0-9]{64}$/);
});

test('parseMigration rejects a badly named file', () => {
  assert.throws(
    () => parseMigration('001-bad.sql', '-- migrate:up\nx\n-- migrate:down\n'),
    /Invalid migration file name/,
  );
});

test('parseMigration rejects a file missing the markers', () => {
  assert.throws(() => parseMigration('0001_x.sql', 'CREATE TABLE x ();'), /must contain/);
});

test('parseMigration rejects an empty up section', () => {
  assert.throws(
    () => parseMigration('0001_x.sql', '-- migrate:up\n\n-- migrate:down\nDROP TABLE x;'),
    /empty up section/,
  );
});

test('the repository migrations load, are ordered and uniquely versioned', async () => {
  const migrations = await loadMigrations(MIGRATIONS_DIR);

  assert.ok(migrations.length >= 8);

  const versions = migrations.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort());
  assert.equal(new Set(versions).size, versions.length);

  for (const migration of migrations) {
    assert.ok(migration.up.length > 0, `${migration.version} has an up section`);
    assert.ok(migration.down.length > 0, `${migration.version} has a down section`);
  }
});
