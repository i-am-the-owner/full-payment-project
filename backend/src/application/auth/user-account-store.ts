import type { UserAccountStatus } from './user-directory.ts';

export interface UserAccountRecord {
  readonly id: string;
  readonly email: string;
  readonly status: UserAccountStatus;
  readonly emailVerified: boolean;
  readonly passwordHash: string | null;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
}

export interface RecordFailedLoginOptions {
  readonly lockThreshold: number;
  readonly lockDurationMinutes: number;
}

/** Persistence for user accounts and their authentication metadata. */
export interface UserAccountStore {
  findByEmail(email: string): Promise<UserAccountRecord | null>;
  findById(id: string): Promise<UserAccountRecord | null>;

  /** Creates the `users` + `user_auth` rows in one transaction. */
  createAccount(input: { email: string; passwordHash: string }): Promise<{ id: string }>;

  setPassword(userId: string, passwordHash: string): Promise<void>;
  /** Changes the account's status (an admin suspending or reinstating it). */
  setStatus(userId: string, status: UserAccountStatus): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;

  /** Atomically increments the failure counter and locks the account past the threshold. */
  recordFailedLogin(
    userId: string,
    options: RecordFailedLoginOptions,
  ): Promise<{ locked: boolean }>;

  /** Clears the failure counter / lock and records the login. */
  recordSuccessfulLogin(userId: string, ipAddress: string | undefined): Promise<void>;
}
