/**
 * Everything the admin console can READ. There is deliberately no method here
 * that writes: an admin cannot change an amount, a status or a recipient. The only
 * things an admin can change are a user's suspension (`ManageUserAccounts`) and an
 * alert's resolved flag (`AdminAlerts`); neither touches money.
 */

export interface Page {
  readonly limit: number;
  readonly offset: number;
}

export interface AdminUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly kycStatus: string | null;
}

export interface AdminUserDetail extends AdminUserRow {
  readonly emailVerified: boolean;
  readonly countryOfResidence: string | null;
  readonly lastLoginAt: Date | null;
  readonly twoFactorEnabled: boolean;
  readonly roles: readonly string[];
  readonly providerLinks: readonly {
    readonly provider: string;
    readonly kycStatus: string;
    readonly providerCustomerId: string | null;
    readonly linkedAt: Date;
    readonly updatedAt: Date;
  }[];
  readonly transferCount: number;
  readonly recentAudit: readonly {
    readonly action: string;
    readonly actorType: string;
    readonly createdAt: Date;
  }[];
}

export interface TransferFilter extends Page {
  /** A transfer id (UUID), SomPay reference or provider transfer id. */
  readonly id?: string | undefined;
  readonly userId?: string | undefined;
  readonly status?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface AdminTransferRow {
  readonly id: string;
  readonly reference: string;
  readonly userId: string;
  readonly status: string;
  readonly provider: string | null;
  readonly providerStatus: string | null;
  readonly sourceCurrency: string;
  readonly sourceAmountMinor: string;
  readonly destinationCurrency: string;
  readonly destinationAmountMinor: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminTransferDetail extends AdminTransferRow {
  readonly feeAmountMinor: string;
  readonly totalToPayMinor: string;
  readonly exchangeRate: string;
  readonly fundingMethod: string | null;
  readonly providerTransferId: string | null;
  readonly failureReason: string | null;
  readonly events: readonly {
    readonly fromStatus: string | null;
    readonly status: string;
    readonly source: string;
    readonly reason: string | null;
    readonly occurredAt: Date;
  }[];
  readonly webhooks: readonly AdminWebhookRow[];
}

export interface AdminWebhookRow {
  readonly id: string;
  readonly provider: string;
  readonly eventType: string;
  readonly signatureVerified: boolean;
  readonly processingStatus: string;
  readonly processingError: string | null;
  readonly relatedTransferId: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface IdentityReviewRow {
  readonly userId: string;
  readonly email: string;
  readonly provider: string;
  readonly kycStatus: string;
  readonly updatedAt: Date;
}

export type VolumePeriod = 'day' | 'month';

export interface VolumeRow {
  /** ISO date of the start of the day or month (UTC). */
  readonly period: string;
  readonly currency: string;
  /** Transfers confirmed in the period (excludes drafts and cancelled ones). */
  readonly transfers: number;
  readonly completed: number;
  /** Source amount, integer minor units as a string, of transfers whose money was taken. */
  readonly volumeMinor: string;
}

export interface AdminQueries {
  searchUsers(filter: { q?: string | undefined } & Page): Promise<AdminUserRow[]>;
  getUser(id: string): Promise<AdminUserDetail | null>;
  searchTransfers(filter: TransferFilter): Promise<AdminTransferRow[]>;
  getTransfer(id: string): Promise<AdminTransferDetail | null>;
  /** Not final and not changed for `olderThanHours`. Drafts are excluded unless asked for. */
  stuckTransfers(
    filter: { olderThanHours: number; includeDrafts: boolean } & Page,
  ): Promise<AdminTransferRow[]>;
  /** FAILED and REFUNDED (a bounce-back ends in one of the two). */
  failedTransfers(filter: Page): Promise<AdminTransferRow[]>;
  /** Rejected (bad signature) and failed-to-process webhook events. */
  webhookErrors(filter: Page): Promise<AdminWebhookRow[]>;
  /** Customers the provider verified whose details do not match ours. */
  identityReviews(filter: Page): Promise<IdentityReviewRow[]>;
  volume(filter: { period: VolumePeriod; from: Date; to: Date }): Promise<VolumeRow[]>;
}
