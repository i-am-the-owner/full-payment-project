export type UserAccountStatus = 'active' | 'suspended' | 'closed';

/** The subset of a user record the API foundation needs. */
export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly status: UserAccountStatus;
  readonly emailVerified: boolean;
}

/** Read-only lookup of user accounts. */
export interface UserDirectory {
  findById(id: string): Promise<UserSummary | null>;
}
