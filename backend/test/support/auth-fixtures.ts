import type { AuthConfig } from '../../src/config/app-config.ts';
import type { AuthenticatedPrincipal, Role } from '../../src/domain/auth/principal.ts';

export const testAuthConfig: AuthConfig = {
  jwtSecret: 'unit-test-secret-unit-test-secret-1234',
  issuer: 'almapay',
  audience: 'almapay-mobile',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  emailVerificationTtlHours: 24,
  passwordResetTtlMinutes: 60,
  passwordMinLength: 12,
  accountLockThreshold: 5,
  accountLockMinutes: 15,
  publicAppUrl: 'https://app.almapay.test',
};

export function principalFixture(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    userId: '11111111-1111-1111-1111-111111111111',
    roles: ['customer'] as Role[],
    tokenId: 'tok-1',
    sessionId: '22222222-2222-2222-2222-222222222222',
    emailVerified: true,
    providerVerified: true,
    needsRelink: false,
    ...overrides,
  };
}
