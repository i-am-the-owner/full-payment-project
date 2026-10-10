/** A role a principal can hold. Kept as a closed set for the foundation. */
export type Role = 'customer' | 'admin' | 'support';

export const ROLES: readonly Role[] = ['customer', 'admin', 'support'];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The authenticated caller, derived from a verified access token. This is the
 * only identity the HTTP layer trusts; it is never taken from the request body
 * or query string.
 */
export interface AuthenticatedPrincipal {
  /** The user's id (the token `sub` claim). */
  readonly userId: string;
  readonly roles: readonly Role[];
  /** The token's unique id (`jti`), useful for correlation. */
  readonly tokenId: string;
  /** The refresh-token session this access token belongs to (`sid` claim). */
  readonly sessionId: string;
  /** Whether the account's email address has been verified. */
  readonly emailVerified: boolean;
  /**
   * Whether the licensed payout provider has verified this customer (KYC).
   * Read from the database on every request; never taken from the token.
   */
  readonly providerVerified: boolean;
  /** The customer must reconnect their provider account before sending. */
  readonly needsRelink: boolean;
}

export function hasAnyRole(principal: AuthenticatedPrincipal, allowed: readonly Role[]): boolean {
  return principal.roles.some((role) => allowed.includes(role));
}
