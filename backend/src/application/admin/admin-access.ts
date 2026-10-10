import type { Role } from '../../domain/auth/principal.ts';

/** What the database says about a person's staff access right now. */
export interface AdminAccess {
  /** Staff roles granted to the user (never `customer`). */
  readonly roles: readonly Role[];
  /** Whether two-step sign-in is turned on for the account. */
  readonly twoFactorEnabled: boolean;
}

/** Read side of staff roles. Granting is done by `scripts/grant-admin.ts`, not by the API. */
export interface AdminAccessStore {
  get(userId: string): Promise<AdminAccess>;
}
