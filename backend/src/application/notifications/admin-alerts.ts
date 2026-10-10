export type AlertSeverity = 'low' | 'medium' | 'high';

export interface NewAdminAlert {
  /** A stable code such as `PAYOUT_FAILED_AFTER_FUNDING`. */
  readonly kind: string;
  readonly severity: AlertSeverity;
  readonly entityType: string;
  readonly entityId: string;
  /** Plain English for the admin. No personal data. */
  readonly message: string;
  /** Identifiers and statuses only: never personal data, bank details or tokens. */
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

export interface AdminAlert extends NewAdminAlert {
  readonly id: string;
  readonly status: 'open' | 'resolved';
  readonly occurrences: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly resolvedAt: Date | undefined;
}

/**
 * Things an admin must look at: a payout that failed after the customer's money
 * was taken, a provider event for a transfer we do not know, a job that gave
 * up. Raising the same problem again bumps its count instead of adding a row.
 */
export interface AdminAlerts {
  raise(alert: NewAdminAlert): Promise<void>;
  list(filter: { status: 'open' | 'resolved' | 'all'; limit: number }): Promise<AdminAlert[]>;
  /** False if there is no such open alert. */
  resolve(id: string, adminUserId: string): Promise<boolean>;
}
