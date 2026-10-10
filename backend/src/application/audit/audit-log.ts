export interface AuditLogEntry {
  readonly actorType: 'user' | 'system' | 'admin' | 'provider';
  readonly actorId?: string | undefined;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Non-sensitive structured context only. Never secrets, tokens or passwords. */
  readonly context?: Record<string, unknown>;
  readonly requestId?: string | undefined;
  readonly ipAddress?: string | undefined;
}

/** Append-only record of security- and money-relevant actions. */
export interface AuditLog {
  record(entry: AuditLogEntry): Promise<void>;
}

/**
 * An audit log whose write can be required to succeed. The admin console uses
 * it to record an action BEFORE doing it: if the record cannot be written, the
 * action does not happen.
 */
export interface StrictAuditLog extends AuditLog {
  recordStrict(entry: AuditLogEntry): Promise<void>;
}
