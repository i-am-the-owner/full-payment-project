import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckReadiness } from '../../../../src/application/health/check-readiness.ts';
import type { DependencyStatus } from '../../../../src/domain/health/readiness.ts';

const up = (name: string): DependencyStatus => ({ name, status: 'up', latencyMs: 1 });
const down = (name: string): DependencyStatus => ({ name, status: 'down', latencyMs: 1 });

test('reports ready when every check passes', async () => {
  const check = createCheckReadiness([
    () => Promise.resolve(up('database')),
    () => Promise.resolve(up('cache')),
  ]);
  const report = await check();

  assert.equal(report.status, 'ready');
  assert.equal(report.checks.length, 2);
});

test('reports not_ready when any check fails', async () => {
  const check = createCheckReadiness([
    () => Promise.resolve(up('database')),
    () => Promise.resolve(down('cache')),
  ]);
  const report = await check();

  assert.equal(report.status, 'not_ready');
});

test('runs checks concurrently and preserves their order', async () => {
  const check = createCheckReadiness([
    () => new Promise((resolve) => setTimeout(() => resolve(up('slow')), 20)),
    () => Promise.resolve(up('fast')),
  ]);
  const report = await check();

  assert.deepEqual(
    report.checks.map((c) => c.name),
    ['slow', 'fast'],
  );
});
