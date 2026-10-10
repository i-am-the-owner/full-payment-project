import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthConfig } from '../../config/app-config.ts';
import { isRole, type Role } from '../../domain/auth/principal.ts';
import {
  InvalidTokenError,
  type AccessTokenClaims,
  type TokenService,
  type VerifiedTokenPrincipal,
} from '../../application/auth/token-service.ts';

const ALGORITHM = 'HS256';

interface RawTokenPayload {
  sub?: unknown;
  jti?: unknown;
  sid?: unknown;
  roles?: unknown;
  email_verified?: unknown;
}

function parseRoles(value: unknown): readonly Role[] {
  if (!Array.isArray(value)) {
    throw new InvalidTokenError('roles claim is missing or not an array');
  }
  const roles: Role[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !isRole(entry)) {
      throw new InvalidTokenError('roles claim contains an unknown role');
    }
    roles.push(entry);
  }
  return roles;
}

function requireString(value: unknown, claim: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidTokenError(`${claim} claim is missing`);
  }
  return value;
}

/** JWT (HS256) implementation of {@link TokenService} backed by `jose`. */
export class JwtTokenService implements TokenService {
  readonly #secret: Uint8Array;
  readonly #issuer: string;
  readonly #audience: string;
  readonly #ttlSeconds: number;

  constructor(config: AuthConfig) {
    this.#secret = new TextEncoder().encode(config.jwtSecret);
    this.#issuer = config.issuer;
    this.#audience = config.audience;
    this.#ttlSeconds = config.accessTokenTtlSeconds;
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      roles: [...claims.roles],
      sid: claims.sessionId,
      email_verified: claims.emailVerified,
    })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(claims.userId)
      .setIssuer(this.#issuer)
      .setAudience(this.#audience)
      .setIssuedAt()
      .setExpirationTime(`${this.#ttlSeconds}s`)
      .setJti(randomUUID())
      .sign(this.#secret);
  }

  async verifyAccessToken(token: string): Promise<VerifiedTokenPrincipal> {
    let payload: RawTokenPayload;
    try {
      ({ payload } = await jwtVerify(token, this.#secret, {
        algorithms: [ALGORITHM],
        issuer: this.#issuer,
        audience: this.#audience,
      }));
    } catch (error) {
      throw new InvalidTokenError(
        error instanceof Error ? error.message : 'token verification failed',
      );
    }

    return {
      userId: requireString(payload.sub, 'sub'),
      tokenId: requireString(payload.jti, 'jti'),
      sessionId: requireString(payload.sid, 'sid'),
      roles: parseRoles(payload.roles),
      emailVerified: payload.email_verified === true,
    };
  }
}
