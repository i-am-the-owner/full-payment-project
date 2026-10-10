import type { TransferStatus } from './transfer-status.ts';

/**
 * SomPay's own payout vocabulary. Provider adapters convert to and from these
 * types; a provider's raw response shape never leaves its adapter.
 */

export const PROVIDER_NAMES = ['mock', 'wise', 'airwallex', 'currencycloud'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** How each provider is named to customers ("your money goes directly to ..."). */
export const PROVIDER_DISPLAY_NAMES: Readonly<Record<ProviderName, string>> = {
  mock: 'Mock Payments (test provider)',
  wise: 'Wise',
  airwallex: 'Airwallex',
  currencycloud: 'Currencycloud',
};

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** An amount in integer minor units (pence, cents). Never a float. */
export interface Money {
  readonly currency: string;
  readonly amountMinor: bigint;
}

export interface Currency {
  /** ISO 4217 code. */
  readonly code: string;
  readonly name: string;
  /** Number of minor-unit digits (2 for GBP, 0 for JPY, 3 for KWD). */
  readonly minorUnit: number;
}

export type FundingMethod = 'BANK_TRANSFER' | 'BALANCE';

export interface Capabilities {
  readonly provider: ProviderName;
  readonly sourceCurrencies: readonly string[];
  readonly targetCurrencies: readonly string[];
  readonly features: {
    /** KYC / account linking happens on a provider-hosted page. */
    readonly needsCustomerRedirectForKyc: boolean;
    /** How the customer can pay the provider for a transfer. */
    readonly fundingMethods: readonly FundingMethod[];
  };
  /**
   * Countries (ISO 3166-1 alpha-2) whose residents the provider accepts as
   * senders. Absent when the provider does not say; configuration then decides.
   */
  readonly senderCountries?: readonly string[] | undefined;
  /**
   * For each target currency, the countries (ISO 3166-1 alpha-2) the provider
   * can pay it out in. Absent when the provider does not publish this.
   */
  readonly payoutCountries?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * Interface operations this provider cannot perform, each with a short
   * reason. Empty when everything is supported.
   */
  readonly unsupportedOperations: readonly string[];
}

// --- Customers -------------------------------------------------------------

/** The profile the customer gave us. Personal data: never log it. */
export interface CustomerProfile {
  readonly firstName: string;
  readonly lastName: string;
  /** ISO date, `YYYY-MM-DD`. */
  readonly dateOfBirth: string;
  /** ISO 3166-1 alpha-2. */
  readonly countryOfResidence: string;
  /** E.164. */
  readonly phone: string;
}

export interface OnboardingUser {
  readonly id: string;
  readonly email: string;
  readonly profile?: CustomerProfile | undefined;
}

export interface OnboardingContext {
  /**
   * Where the provider must send the customer's browser when it is finished.
   * It already carries our single-use CSRF `state` parameter.
   */
  readonly returnUrl: string;
}

export type OnboardingStart =
  | {
      readonly kind: 'redirect';
      readonly url: string;
      /** Set when the provider already created the customer at this point. */
      readonly link?: ProviderCustomerLink | undefined;
    }
  | { readonly kind: 'done' };

/** The person the provider verified, when it tells us. Personal data. */
export interface VerifiedIdentity {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly dateOfBirth?: string | undefined;
}

export interface CompletedOnboarding {
  readonly link: ProviderCustomerLink;
  /** A provider refresh token to store encrypted. Never an access token. */
  readonly refreshToken?: string | undefined;
  readonly verifiedIdentity?: VerifiedIdentity | undefined;
}

/** Our reference to a customer's own account at the provider. Not a secret. */
export interface ProviderCustomerLink {
  readonly provider: ProviderName;
  /** The provider's id for the customer. */
  readonly customerRef: string;
  /** The provider's profile / account id, when it has one separate from the customer. */
  readonly profileRef?: string | undefined;
}

export type CustomerStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NEEDS_RELINK';

// --- Quotes ----------------------------------------------------------------

export interface PayoutQuote {
  readonly id: string;
  /** Exact decimal string: target units per 1 source unit. */
  readonly rate: string;
  /** The provider's fee, in the source currency, included in `sourceAmount`. */
  readonly fee: Money;
  /** Everything the customer pays, fee included. */
  readonly sourceAmount: Money;
  /** What the recipient receives. */
  readonly targetAmount: Money;
  readonly expiresAt: Date;
  readonly estimatedDelivery: Date | undefined;
}

// --- Dynamic forms ---------------------------------------------------------

export type FormFieldType = 'text' | 'select' | 'radio' | 'date';

export interface FormFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FormField {
  readonly key: string;
  readonly label: string;
  readonly type: FormFieldType;
  readonly required: boolean;
  /** The `key` of the group this field belongs to. */
  readonly group: string;
  readonly validation: {
    readonly pattern?: string;
    readonly minLength?: number;
    readonly maxLength?: number;
  };
  /** Present for `select` and `radio` fields. */
  readonly options?: readonly FormFieldOption[];
  /** The form must be fetched again (with partial values) when this changes. */
  readonly refreshOnChange: boolean;
  readonly example?: string;
}

export interface FormGroup {
  readonly key: string;
  readonly label: string;
}

/** A form whose fields come from the provider at runtime. */
export interface DynamicForm {
  readonly groups: readonly FormGroup[];
  readonly fields: readonly FormField[];
}

export type FormValues = Readonly<Record<string, string>>;

// --- Recipients ------------------------------------------------------------

/** Summary only: full bank details live at the provider, not with SomPay. */
export interface PayoutRecipient {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly country: string;
  /** Masked identifier, e.g. `IBAN ••••1234`. */
  readonly accountSummary: string;
}

// --- Transfers -------------------------------------------------------------

export interface PayoutTransfer {
  /** The provider's id for the transfer. */
  readonly id: string;
  /** `null` when the provider reports a status we do not recognise. */
  readonly status: TransferStatus | null;
  /** The provider's own status word, kept for the audit trail only. */
  readonly providerStatus: string;
  readonly reference: string | undefined;
}

export interface BankDetail {
  readonly label: string;
  readonly value: string;
}

export type FundingInstructions =
  | {
      readonly method: 'BANK_TRANSFER';
      readonly amount: Money;
      /** The provider's account the customer pays into. Never SomPay's. */
      readonly bankDetails: readonly BankDetail[];
      readonly reference: string;
    }
  | { readonly method: 'BALANCE'; readonly amount: Money };

export interface FundingResult {
  readonly status: 'COMPLETED' | 'PENDING' | 'REJECTED' | 'SCA_REQUIRED';
  readonly errorCode: string | undefined;
}

// --- Webhooks --------------------------------------------------------------

export interface NormalisedEvent {
  readonly type: 'transfer.status_changed' | 'customer.status_changed' | 'unknown';
  readonly providerTransferId: string | undefined;
  /** `null` when the provider status has no SomPay meaning. */
  readonly newStatus: TransferStatus | null;
  readonly providerStatus: string | undefined;
  /** The provider's own id for this event, when its signed payload carries one. */
  readonly eventId: string | undefined;
  readonly occurredAt: Date;
  /** The provider's parsed payload, for the webhook event log only. */
  readonly raw: unknown;
  /**
   * `customer.status_changed` only: the provider's id for the customer (or
   * their profile / account) and the verification status it reported. `null`
   * when the provider's status has no SomPay meaning.
   */
  readonly providerCustomerRef?: string | undefined;
  readonly newCustomerStatus?: CustomerStatus | null | undefined;
}

export type WebhookHeaders = Readonly<Record<string, string | undefined>>;
