import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createDatabasePool,
  type DatabasePool,
} from '../../../src/infrastructure/database/pool.ts';
import { loadMigrations, migrate } from '../../../src/infrastructure/database/migrator.ts';
import { PostgresJobQueue } from '../../../src/infrastructure/database/postgres-job-queue.ts';
import { PostgresAdminAlerts } from '../../../src/infrastructure/database/postgres-admin-alerts.ts';
import { silentLogger } from '../../support/webhook-world.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const suite = DATABASE_URL ? test : test.skip;

let pool: DatabasePool;
let queue: PostgresJobQueue;

before(async () => {
  if (!DATABASE_URL) return;
  pool = createDatabasePool(DATABASE_URL);
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR), { info: () => {} });
  queue = new PostgresJobQueue(pool);
});
after(async () => {
  if (pool) await pool.end();
});
beforeEach(async () => {
  if (pool) await pool.query(`TRUNCATE jobs, admin_alerts`);
});

suite('two workers never take the same job', async () => {
  for (let i = 0; i < 10; i += 1) {
    await queue.enqueue({ type: 't', payload: { i } });
  }
  const claims = await Promise.all(
    Array.from({ length: 10 }, (_, n) => queue.claim(`worker-${n}`, new Date())),
  );
  const ids = claims.map((job) => job?.id);
  assert.ok(ids.every((id) => id !== undefined && id !== null));
  assert.equal(new Set(ids).size, 10);
  assert.ok(claims.every((job) => job?.attempts === 1));
  assert.equal(await queue.claim('late', new Date()), null);
});

suite('a job is not taken before it is due, and keeps its order', async () => {
  const now = new Date();
  await queue.enqueue({ type: 'later', runAt: new Date(now.getTime() + 60_000) });
  await queue.enqueue({ type: 'second', runAt: new Date(now.getTime() - 1000) });
  await queue.enqueue({ type: 'first', runAt: new Date(now.getTime() - 5000) });
  assert.equal((await queue.claim('w', now))?.type, 'first');
  assert.equal((await queue.claim('w', now))?.type, 'second');
  assert.equal(await queue.claim('w', now), null);
});

suite('a failed job returns to the queue, or is parked when it has no more attempts', async () => {
  const { id } = await queue.enqueue({ type: 't', maxAttempts: 2 });
  const first = await queue.claim('w', new Date());
  await queue.fail(id, 'first problem', new Date(Date.now() - 1));
  const second = await queue.claim('w', new Date());
  assert.equal(first?.attempts, 1);
  assert.equal(second?.attempts, 2);
  await queue.fail(id, 'second problem', null);
  const { rows } = await pool.query<{ status: string; last_error: string }>(
    `SELECT status, last_error FROM jobs WHERE id = $1`,
    [id],
  );
  assert.deepEqual(rows[0], { status: 'dead', last_error: 'second problem' });
  assert.equal(await queue.claim('w', new Date()), null);
});

suite('enqueueing with the same key makes one job, even concurrently', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => queue.enqueue({ type: 't', dedupeKey: 'same' })),
  );
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  const { rows } = await pool.query(`SELECT 1 FROM jobs`);
  assert.equal(rows.length, 1);
});

suite(
  'a job a dead worker was holding is given back, and old finished jobs are removed',
  async () => {
    const { id } = await queue.enqueue({ type: 't' });
    await queue.claim('dead-worker', new Date());
    await pool.query(`UPDATE jobs SET locked_at = now() - interval '10 minutes' WHERE id = $1`, [
      id,
    ]);
    assert.equal(await queue.releaseStale(new Date(Date.now() - 5 * 60_000)), 1);
    assert.equal((await queue.claim('w', new Date()))?.id, id);

    await queue.complete(id);
    await pool.query(`UPDATE jobs SET finished_at = now() - interval '30 days' WHERE id = $1`, [
      id,
    ]);
    assert.equal(await queue.prune(new Date(Date.now() - 14 * 24 * 3600_000)), 1);
  },
);

suite(
  'admin alerts: one open alert per problem, repeats are counted, resolving frees the slot',
  async () => {
    const alerts = new PostgresAdminAlerts(pool, silentLogger);
    const alert = {
      kind: 'PAYOUT_FAILED_AFTER_FUNDING',
      severity: 'high' as const,
      entityType: 'transfer',
      entityId: 't-1',
      message: 'm',
      context: { reference: 'ALM-1' },
    };
    await alerts.raise(alert);
    await alerts.raise(alert);
    await alerts.raise({ ...alert, entityId: 't-2' });
    const open = await alerts.list({ status: 'open', limit: 10 });
    assert.equal(open.length, 2);
    assert.equal(open.find((a) => a.entityId === 't-1')?.occurrences, 2);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM admin_alerts WHERE entity_id = 't-1'`,
    );
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ('alerts-admin@example.test') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    );
    assert.equal(await alerts.resolve(rows[0]!.id, user.rows[0]!.id), true);
    assert.equal(await alerts.resolve(rows[0]!.id, user.rows[0]!.id), false);
    await alerts.raise(alert); // a new open alert, the old one is history
    assert.equal((await alerts.list({ status: 'all', limit: 10 })).length, 3);
  },
);
