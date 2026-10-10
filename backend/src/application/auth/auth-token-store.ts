export type AuthTokenPurpose = 'email_verification' | 'password_reset';

export interface IssueAuthTokenInput {
  readonly userId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly ipAddress?: string | undefined;
}

/** Single-use, time-limited tokens for email verification and password reset. */
export interface AuthTokenStore {
  issue(input: IssueAuthTokenInput): Promise<void>;

  /**
   * Atomically consumes a token: marks it used and returns the owning user id,
   * or `null` if there is no matching unconsumed, unexpired token.
   */
  consume(input: {
    purpose: AuthTokenPurpose;
    tokenHash: string;
  }): Promise<{ userId: string } | null>;

  invalidateAllPending(userId: string, purpose: AuthTokenPurpose): Promise<void>;
}
