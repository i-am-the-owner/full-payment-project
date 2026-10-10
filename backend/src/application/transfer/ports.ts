import type {
  Currency,
  CustomerProfile,
  NormalisedEvent,
  CustomerStatus,
  FundingMethod,
  Money,
  ProviderCustomerLink,
  ProviderName,
} from '../../domain/payout/models.ts';
import type { LocalTransferStatus, TransferStatus } from '../../domain/payout/transfer-status.ts';
import type {
  Recipient,
  Transfer,
  TransferEvent,
  TransferQuote,
} from '../../domain/transfer/models.ts';

// --- Reference data ----------------------------------------------------

/** Raised by `CurrencyRegistry.minorUnitExponent` for a currency it does not know. */
export class UnknownCurrencyError extends Error {
  constructor(currency: string) {
    super(`Unknown currency "${currency}": no minor-unit exponent is configured`);
    this.name = 'UnknownCurrencyError';
  }
}

/** The local cache of the currencies the provider told us about. */
export interface CurrencyRegistry {
  /**
   * Minor-unit exponent for an ISO 4217 code (2 for GBP, 0 for JPY).
   * @throws {UnknownCurrencyError} never guesses a default.
   */
  minorUnitExponent(currency: string): Promise<number>;
  /** Stores the provider's currency list so stored amounts can be formatted. */
  upsertMany(currencies: readonly Currency[]): Promise<void>;
}

// --- Customers ---------------------------------------------------------

/**
 * What we store about a customer's verification. The provider's own statuses,
 * plus `REJECTED_PENDING_REVIEW`: the provider verified someone whose name or
 * date of birth does not match our profile. Only a person's review clears it.
 */
export type KycStatus = CustomerStatus | 'REJECTED_PENDING_REVIEW';

/** `UNVERIFIED` means the customer has not started onboarding with the provider. */
export type StoredCustomerStatus = KycStatus | 'UNVERIFIED';

export interface CustomerLinkRecord {
  readonly link: ProviderCustomerLink;
  readonly status: KycStatus;
}

/**
 * A customer's link to their own account at a provider (`provider_links`), and
 * the verification status that provider reported. There is deliberately no way
 * to mark a customer VERIFIED here except {@link recordProviderStatus}, whose
 * only callers pass on what the provider returned.
 */
export interface CustomerLinkStore {
  /** The link, once the provider has given us a customer id. */
  find(userId: string, provider: ProviderName): Promise<CustomerLinkRecord | null>;
  /** The stored status, even before a customer id exists. Null if onboarding never started. */
  status(userId: string, provider: ProviderName): Promise<KycStatus | null>;
  /** Records that onboarding started: a PENDING row, if there is none yet. */
  beginLink(userId: string, provider: ProviderName): Promise<void>;
  /** Stores the provider's customer id. A different customer resets the status to PENDING. */
  saveLink(userId: string, link: ProviderCustomerLink): Promise<void>;
  /**
   * Stores the status the provider reported. Ignored while the link is
   * REJECTED_PENDING_REVIEW: a provider "verified" must not undo that.
   */
  recordProviderStatus(
    userId: string,
    provider: ProviderName,
    status: CustomerStatus,
  ): Promise<void>;
  /**
   * Records that the provider-verified identity was compared with our profile
   * and matched (or that the provider gave nothing to compare). Until then a
   * link can never become VERIFIED, whoever reports it.
   */
  markIdentityChecked(userId: string, provider: ProviderName): Promise<void>;
  /** The provider-verified identity does not match our profile. */
  flagIdentityMismatch(userId: string, provider: ProviderName): Promise<void>;
  /**
   * Applies a status the provider announced by webhook, found by the provider's
   * id for the customer. Applies it only if it is newer than the last one and
   * the link is not held for review or waiting for its identity check.
   */
  recordProviderStatusByRef(
    provider: ProviderName,
    providerRef: string,
    status: CustomerStatus,
    occurredAt: Date,
  ): Promise<CustomerStatusUpdate>;
  /** The provider refused the customer's credentials: they must connect again. */
  markNeedsRelink(provider: ProviderName, customerRef: string): Promise<void>;
  /**
   * Stores a provider refresh token, encrypted at rest. Access tokens are never
   * stored. Throws if no encryption key is configured – a token is never
   * written in the clear.
   */
  saveRefreshToken(userId: string, provider: ProviderName, refreshToken: string): Promise<void>;
  /** The decrypted refresh token, or null if none is stored. */
  readRefreshToken(userId: string, provider: ProviderName): Promise<string | null>;
  /** The same, found by the provider's id for the customer (a provider call has no user id). */
  readRefreshTokenByRef(provider: ProviderName, customerRef: string): Promise<string | null>;
  saveRefreshTokenByRef(
    provider: ProviderName,
    customerRef: string,
    refreshToken: string,
  ): Promise<void>;
}

export type CustomerStatusUpdate =
  | { readonly outcome: 'applied'; readonly userId: string; readonly previous: KycStatus }
  | { readonly outcome: 'unchanged'; readonly userId: string }
  | {
      readonly outcome: 'unknown_customer' | 'stale' | 'held_for_review' | 'identity_not_checked';
      readonly userId?: string | undefined;
    };

/** Single-use CSRF state for the provider's redirect back to us. */
export interface OnboardingStateStore {
  /** Stores the SHA-256 of a state; the state itself is never stored. */
  create(input: {
    userId: string;
    provider: ProviderName;
    stateHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Atomically marks an unexpired, unused state as used and returns whose it was. */
  consume(stateHash: string, now: Date): Promise<{ userId: string; provider: ProviderName } | null>;
}

/** The customer's own profile fields on `users`. Personal data. */
export interface ProfileStore {
  get(userId: string): Promise<Partial<CustomerProfile>>;
  save(userId: string, profile: CustomerProfile): Promise<void>;
}

// --- Quotes -------------------------------------------------------

export interface CreateQuoteRecord {
  readonly userId: string;
  readonly source: Money;
  readonly fee: Money;
  readonly target: Money;
  readonly exchangeRate: string;
  readonly provider: ProviderName;
  readonly providerQuoteId: string;
  readonly estimatedDelivery: Date | undefined;
  readonly expiresAt: Date;
}

export interface QuoteRepository {
  create(record: CreateQuoteRecord): Promise<TransferQuote>;
  findById(id: string): Promise<TransferQuote | null>;
}

// --- Recipients --------------------------------------------------

export interface CreateRecipientRecord {
  readonly userId: string;
  readonly displayName: string;
  readonly accountHolderName: string;
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly accountSummary: string;
  readonly provider: ProviderName;
  readonly providerRecipientId: string;
}

export interface RecipientRepository {
  create(record: CreateRecipientRecord): Promise<Recipient>;
  findById(id: string): Promise<Recipient | null>;
  /** Active recipients only. */
  listForUser(userId: string): Promise<Recipient[]>;
  /** Soft delete: the row is kept (transfers refer to it) but no longer offered. */
  archive(id: string): Promise<void>;
  /** How many recipients the customer has added since `since`. */
  countCreatedSince(userId: string, since: Date): Promise<number>;
}

// --- Transfers -------------------------------------------------

export interface CreateTransferRecord {
  readonly reference: string;
  readonly userId: string;
  readonly recipientId: string;
  readonly quoteId: string;
  readonly idempotencyKey: string;
  readonly source: Money;
  readonly fee: Money;
  readonly target: Money;
  readonly exchangeRate: string;
  readonly answers: Readonly<Record<string, string>>;
  readonly recipientReference?: string | undefined;
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}

/** A status SomPay sets on its own authority: a rejection or a cancellation. */
export interface LocalStatusChange {
  readonly status: LocalTransferStatus;
  readonly failureReason: string;
  /** Who asked for it: the customer (a cancellation) or SomPay itself. */
  readonly actor: 'user' | 'system';
}

export type ProviderEvidenceSource = 'provider_webhook' | 'provider_lookup' | 'provider_response';

/**
 * Proof that a status came from the provider: a signature-verified webhook, a
 * lookup of the transfer at the provider, or the provider's response to a call
 * we made. It is the ONLY way to move a transfer into a status that describes
 * what the provider did with the money, and the only way out of FAILED.
 */
export interface ProviderStatusEvidence {
  readonly source: ProviderEvidenceSource;
  readonly provider: ProviderName;
  readonly providerTransferId: string;
  readonly providerStatus: string;
  readonly status: TransferStatus;
  /** The provider's own timestamp for this event. */
  readonly occurredAt: Date;
  /** Redacted provider payload, recorded on the transfer event. No personal data. */
  readonly eventPayload?: unknown;
}

/** An event older than one already applied: the provider's webhooks arrived out of order. */
export class StaleProviderEventError extends Error {
  constructor() {
    super('A newer provider event has already been applied to this transfer');
    this.name = 'StaleProviderEventError';
  }
}

/** Raised when the database state machine rejects a status transition. */
export class InvalidTransferTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Transfer status transition "${from}" -> "${to}" is not allowed`);
    this.name = 'InvalidTransferTransitionError';
  }
}

export interface TransferRepository {
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Transfer | null>;
  findById(id: string): Promise<Transfer | null>;
  findByQuoteId(quoteId: string): Promise<Transfer | null>;
  findByProviderTransferId(
    provider: ProviderName,
    providerTransferId: string,
  ): Promise<Transfer | null>;
  /** Newest first. */
  listForUser(userId: string, page: Page): Promise<Transfer[]>;
  /** The transfer's status timeline, oldest first. */
  listEvents(transferId: string): Promise<TransferEvent[]>;
  /**
   * Everything the customer has committed to pay (fee included) in `currency`
   * on transfers created since `since`, in minor units. Cancelled, failed and
   * refunded transfers do not count.
   */
  totalPaidSince(userId: string, currency: string, since: Date): Promise<bigint>;
  create(record: CreateTransferRecord): Promise<Transfer>;
  attachProviderTransfer(
    transferId: string,
    provider: ProviderName,
    providerTransferId: string,
  ): Promise<void>;
  /** Records how the transfer was paid for. */
  recordFundingMethod(transferId: string, method: FundingMethod): Promise<void>;
  /**
   * Fails or cancels a transfer on SomPay's own authority. Cannot express any
   * other status, and the database rejects it where provider evidence is needed.
   */
  applyLocalStatusChange(transferId: string, change: LocalStatusChange): Promise<Transfer>;
  /**
   * Applies a provider-confirmed status. Throws {@link InvalidTransferTransitionError}
   * on an illegal transition and {@link StaleProviderEventError} when a webhook
   * is older than one already applied.
   */
  applyProviderStatus(transferId: string, evidence: ProviderStatusEvidence): Promise<Transfer>;
  /**
   * Records a provider event that was NOT applied (out of order or an
   * impossible step) on the transfer's event history, flagged as not applied.
   */
  recordIgnoredEvent(
    transferId: string,
    evidence: ProviderStatusEvidence,
    reason: string,
  ): Promise<void>;
  /**
   * Transfers handed to `provider` that are not final and have had no status
   * change since `unchangedSince`, least recently polled first.
   */
  listStuck(query: {
    provider: ProviderName;
    unchangedSince: Date;
    createdAfter: Date;
    notPolledSince: Date;
    limit: number;
  }): Promise<Transfer[]>;
  /** DRAFT transfers for `provider` that never got a provider transfer id. */
  listUnsubmitted(query: {
    provider: ProviderName;
    createdBefore: Date;
    createdAfter: Date;
    notPolledSince: Date;
    limit: number;
  }): Promise<Transfer[]>;
  markPolled(transferId: string, at: Date): Promise<void>;
  /** How many of the customer's transfers failed since `since`. */
  countFailedSince(userId: string, since: Date): Promise<number>;
}

// --- Webhook events ------------------------------------------

export type WebhookProcessingResult = 'processed' | 'ignored' | 'failed';

/** What is kept of a verified delivery: the normalised event, never the raw body. */
export interface StoredWebhookEvent {
  readonly id: string;
  readonly provider: ProviderName;
  readonly providerEventId: string;
  readonly event: NormalisedEvent;
  /** True once processing has finished, one way or another. */
  readonly processed: boolean;
}

export interface WebhookEventRepository {
  /**
   * Records a delivery whose signature did NOT verify, so the attempt can be
   * seen. Nothing from the body is kept except its length and SHA-256.
   */
  recordUnverified(input: {
    provider: ProviderName;
    bodySha256: string;
    bodyBytes: number;
  }): Promise<void>;
  /**
   * Records a signature-verified delivery. Idempotent on
   * (provider, providerEventId): a repeat returns the existing row with
   * `isNew: false`.
   */
  recordVerified(input: {
    provider: ProviderName;
    /** The provider's event id, or the hash of the signed body when it has none. */
    providerEventId: string;
    /** SHA-256 of the signed body. */
    bodyHash: string;
    event: NormalisedEvent;
    /** The event payload after redaction. */
    redactedPayload: unknown;
  }): Promise<{ id: string; isNew: boolean; processed: boolean }>;
  findById(id: string): Promise<StoredWebhookEvent | null>;
  /** Links the delivery to the transfer it concerned. */
  relateToTransfer(id: string, transferId: string): Promise<void>;
  markProcessed(id: string, result: WebhookProcessingResult, note?: string): Promise<void>;
}
