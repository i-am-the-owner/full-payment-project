import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { JwtTokenService } from '../../../../src/infrastructure/auth/jwt-token-service.ts';
import { InvalidTokenError } from '../../../../src/application/auth/token-service.ts';
import { testAuthConfig } from '../../../support/auth-fixtures.ts';

const config = testAuthConfig;
const service = new JwtTokenService(config);
const secret = new TextEncoder().encode(config.jwtSecret);
const userId = '11111111-1111-1111-1111-111111111111';
const sessionId = '99999999-9999-9999-9999-999999999999';

function claims(): {
  userId: string;
  roles: readonly ['customer'];
  sessionId: string;
  emailVerified: boolean;
} {
  return { userId, roles: ['customer'] as const, sessionId, emailVerified: false };
}

test('issues then verifies an access token, round-tripping the claims', async () => {
  const token = await service.issueAccessToken(claims());
  const principal = await service.verifyAccessToken(token);

  assert.equal(principal.userId, userId);
  assert.equal(principal.sessionId, sessionId);
  assert.deepEqual(principal.roles, ['customer']);
  assert.equal(principal.emailVerified, false);
  assert.match(principal.tokenId, /^[0-9a-f-]{36}$/);
});

test('rejects a token signed with a different secret', async () => {
  const foreign = new JwtTokenService({
    ...config,
    jwtSecret: 'a-completely-different-secret-value-xx',
  });
  const token = await foreign.issueAccessToken(claims());

  await assert.rejects(service.verifyAccessToken(token), InvalidTokenError);
});

test('rejects an expired token', async () => {
  const token = await new SignJWT({ roles: ['customer'], sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .setJti('expired')
    .sign(secret);

  await assert.rejects(service.verifyAccessToken(token), InvalidTokenError);
});

test('rejects a token with the wrong issuer', async () => {
  const token = await new SignJWT({ roles: ['customer'], sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('someone-else')
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti('x')
    .sign(secret);

  await assert.rejects(service.verifyAccessToken(token), InvalidTokenError);
});

test('rejects an unsigned (alg: none) token', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      roles: ['admin'],
      sid: sessionId,
      iss: config.issuer,
      aud: config.audience,
    }),
  ).toString('base64url');

  await assert.rejects(service.verifyAccessToken(`${header}.${payload}.`), InvalidTokenError);
});

test('rejects a token missing the sid claim', async () => {
  const token = await new SignJWT({ roles: ['customer'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti('x')
    .sign(secret);

  await assert.rejects(service.verifyAccessToken(token), /sid claim is missing/);
});

test('rejects a token whose roles claim contains an unknown role', async () => {
  const token = await new SignJWT({ roles: ['customer', 'superuser'], sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti('x')
    .sign(secret);

  await assert.rejects(service.verifyAccessToken(token), /unknown role/);
});

test('rejects a garbage string', async () => {
  await assert.rejects(service.verifyAccessToken('not-a-jwt'), InvalidTokenError);
});
