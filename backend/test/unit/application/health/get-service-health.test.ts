import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetServiceHealth } from '../../../../src/application/health/get-service-health.ts';

test('get service health reports status, version and floored uptime', () => {
  const fixedNow = new Date('2026-01-01T00:00:00.000Z');
  const getServiceHealth = createGetServiceHealth({
    version: '1.2.3',
    uptimeSeconds: () => 42.9,
    now: () => fixedNow,
  });

  const health = getServiceHealth();

  assert.deepEqual(health, {
    status: 'ok',
    version: '1.2.3',
    uptimeSeconds: 42,
    checkedAt: fixedNow,
  });
});
