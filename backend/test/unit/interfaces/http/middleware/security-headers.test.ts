import test from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders } from '../../../../../src/interfaces/http/middleware/security-headers.ts';
import type { HttpSecurityConfig } from '../../../../../src/config/app-config.ts';
import { mockRequest, runMiddleware } from '../../../../support/http-mocks.ts';

const base: HttpSecurityConfig = {
  trustProxy: false,
  hstsEnabled: false,
  requireHttps: false,
};

test('sets the baseline security headers', async () => {
  const { response } = await runMiddleware(securityHeaders(base), mockRequest());

  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(response.headers['X-Frame-Options'], 'DENY');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(
    response.headers['Content-Security-Policy'],
    "default-src 'none'; frame-ancestors 'none'",
  );
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['Strict-Transport-Security'], undefined);
});

test('adds HSTS only when enabled', async () => {
  const { response } = await runMiddleware(
    securityHeaders({ ...base, hstsEnabled: true }),
    mockRequest(),
  );
  assert.match(response.headers['Strict-Transport-Security'] ?? '', /max-age=31536000/);
});
