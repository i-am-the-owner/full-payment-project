import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { ForbiddenError } from '../../../../../src/shared/errors.ts';
import { requireHttps } from '../../../../../src/interfaces/http/middleware/require-https.ts';

function run(enabled: boolean, secure: boolean): unknown {
  let seen: unknown = 'not called';
  requireHttps(enabled)({ secure } as Request, {} as Response, (error?: unknown) => {
    seen = error;
  });
  return seen;
}

test('in production behind a proxy, a request that did not arrive over HTTPS is refused', () => {
  const refused = run(true, false);
  assert.ok(refused instanceof ForbiddenError);
  assert.equal(refused.message, 'HTTPS is required for this API.');
});

test('an HTTPS request passes, and nothing is enforced when it is switched off (development)', () => {
  assert.equal(run(true, true), undefined);
  assert.equal(run(false, false), undefined);
});
