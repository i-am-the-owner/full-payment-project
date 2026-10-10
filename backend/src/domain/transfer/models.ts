import type { FundingMethod, Money, ProviderName } from '../payout/models.ts';
import type { TransferStatus } from '../payout/transfer-status.ts';

export type { Money } from '../payout/models.ts';

/**
 * SomPay's local copy of a provider quote. Stored immutably so history never
 * needs the provider, and so a transfer can only be created from a quote the
 * backend itself obtained.
 */
export interface TransferQuote {
  readonly id: string;
  readonly userId: string;
  /** The amount converted: what the customer pays, minus the fee. */
  readonly source: Money;
  /** The provider's fee, in the source currency. */
  readonly fee: Money;
  /** Everything the customer pays: `source + fee`. */
  readonly totalToPay: Money;
  /** The amount the recipient receives. */
  readonly target: Money;
  /** Exact decimal, target per 1 source. */
  readonly exchangeRate: string;
  /** Undefined only for quotes created before the provider layer existed. */
  readonly provider: ProviderName | undefined;
  readonly providerQuoteId: string | undefined;
  readonly estimatedDelivery: Date | undefined;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * A recipient summary. Full bank details are held by the provider only;
 * SomPay keeps just enough to show and select the recipient.
 */
export interface Recipient {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly accountHolderName: string;
  readonly countryCode: string;
  readonly currencyCode: string;
  /** Masked identifier from the provider, e.g. `IBAN ••••1234`. */
  readonly accountSummary: string;
  readonly provider: ProviderName | undefined;
  readonly providerRecipientId: string | undefined;
  readonly isActive: boolean;
}

export interface Transfer {
  readonly id: string;
  readonly reference: string;
  readonly userId: string;
  readonly recipientId: string;
  readonly quoteId: string;
  readonly status: TransferStatus;
  readonly idempotencyKey: string;
  readonly source: Money;
  readonly fee: Money;
  readonly totalToPay: Money;
  readonly target: Money;
  readonly exchangeRate: string;
  /** The customer's own reference for the recipient, if they gave one. */
  readonly recipientReference: string | undefined;
  /** Answers to the provider's transfer form (e.g. purpose). Not bank details. */
  readonly answers: Readonly<Record<string, string>>;
  readonly provider: ProviderName | undefined;
  readonly providerTransferId: string | undefined;
  readonly providerStatus: string | undefined;
  /** How the transfer was paid for, once known. */
  readonly fundingMethod: FundingMethod | undefined;
  readonly failureReason: string | undefined;
  /**
   * The provider's own timestamp of the newest webhook applied to this
   * transfer. An event older than this is out of order.
   */
  readonly providerStatusAt?: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One status a transfer entered, from our own `transfer_events` table. */
export interface TransferEvent {
  readonly status: TransferStatus;
  /** WEBHOOK, POLL, USER, ADMIN, SYSTEM or PROVIDER_RESPONSE. */
  readonly source: string;
  readonly occurredAt: Date;
  /**
   * False for an event the provider sent that was NOT applied (out of order or
   * an impossible step). Kept for the record; not shown on the customer's timeline.
   */
  readonly applied: boolean;
  /** Why it was not applied. */
  readonly reason?: string | undefined;
}
