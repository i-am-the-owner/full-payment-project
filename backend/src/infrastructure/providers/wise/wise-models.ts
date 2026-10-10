/**
 * SomPay's normalised value objects for Wise resources. The rest of the
 * codebase depends on these, never on raw Wise JSON.
 *
 * Money is always integer minor units (`bigint`) in the stated currency.
 * Exchange rates are kept as exact decimal strings.
 */

export interface WiseMoney {
  readonly currency: string;
  readonly amountMinor: bigint;
}

export interface WiseQuote {
  /** Wise quote id (UUID). */
  readonly id: string;
  readonly source: WiseMoney;
  readonly target: WiseMoney;
  /** Units of target currency per 1 unit of source currency, exact decimal. */
  readonly rate: string;
  readonly rateType: string;
  /** The Wise transfer fee for the selected payment option, in the source currency. */
  readonly wiseFee: WiseMoney;
  readonly payOut: string;
  /** The pay-in / pay-out combination this quote's numbers are for. */
  readonly payInProduct: string | undefined;
  readonly rateExpiresAt: Date;
  readonly quoteExpiresAt: Date;
  readonly status: string;
  readonly estimatedDelivery: Date | undefined;
}

export type WiseRecipientType = 'sort_code' | 'iban' | (string & {});

export interface WiseRecipient {
  readonly id: string;
  readonly currency: string;
  readonly type: WiseRecipientType;
  readonly accountHolderName: string;
  readonly country: string | undefined;
  readonly active: boolean;
  /** Last characters of the account identifier, for a masked summary. Never the full value. */
  readonly accountTail: string | undefined;
}

/**
 * Wise transfer lifecycle states, exactly as documented by Wise. `unknown` is a
 * defensive fallback for a state Wise adds in the future; it is never invented
 * for the happy path. Mapping to SomPay's own states happens in Milestone 7.
 */
export type WiseTransferStatus =
  | 'incoming_payment_waiting'
  | 'incoming_payment_initiated'
  | 'processing'
  | 'funds_converted'
  | 'outgoing_payment_sent'
  | 'charged_back'
  | 'cancelled'
  | 'funds_refunded'
  | 'bounced_back'
  | 'unknown';

export const WISE_TERMINAL_STATUSES: readonly WiseTransferStatus[] = [
  'outgoing_payment_sent',
  'cancelled',
  'funds_refunded',
];

export interface WiseTransfer {
  readonly id: string;
  readonly status: WiseTransferStatus;
  /** The SomPay-supplied idempotency key echoed back by Wise. */
  readonly customerTransactionId: string;
  readonly quoteId: string | undefined;
  readonly targetAccountId: string | undefined;
  readonly reference: string | undefined;
  readonly rate: string | undefined;
  readonly source: WiseMoney | undefined;
  readonly target: WiseMoney | undefined;
  readonly createdAt: Date | undefined;
  readonly hasActiveIssues: boolean;
}

export type WiseFundingStatus = 'COMPLETED' | 'REJECTED';

export interface WiseFundingResult {
  readonly transferId: string;
  readonly status: WiseFundingStatus;
  readonly errorCode: string | undefined;
}

/** A normalised inbound webhook event (`transfers#state-change`). */
export interface WiseTransferStateChangeEvent {
  readonly eventType: 'transfers#state-change';
  readonly schemaVersion: string;
  readonly subscriptionId: string;
  readonly deliveryId: string | undefined;
  readonly isTest: boolean;
  readonly transferId: string;
  readonly currentStatus: WiseTransferStatus;
  readonly previousStatus: WiseTransferStatus | undefined;
  readonly occurredAt: Date;
}

/** A currency Wise can send (`GET /currencies`). */
export interface WiseCurrency {
  readonly code: string;
  readonly name: string;
  /** False for currencies with no minor unit (JPY, KRW, ...). */
  readonly supportsDecimals: boolean;
}

export interface WiseProfile {
  readonly id: string;
  /** `PERSONAL` or `BUSINESS`. */
  readonly type: string;
  /** `VISIBLE`, `HIDDEN` or `DEACTIVATED`. */
  readonly currentState: string;
}

/** One field of a Wise dynamic form (account or transfer requirements). */
export interface WiseRequirementField {
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  /** Changing this field can change the other fields: re-request with the values so far. */
  readonly refreshRequirementsOnChange: boolean;
  readonly example: string | undefined;
  readonly minLength: number | undefined;
  readonly maxLength: number | undefined;
  readonly validationRegexp: string | undefined;
  readonly valuesAllowed: readonly { readonly key: string; readonly name: string }[] | undefined;
}

/** A titled section of fields. */
export interface WiseRequirementSection {
  readonly name: string;
  readonly fields: readonly WiseRequirementField[];
}

/** One way of doing something (for a recipient: one account type, e.g. `iban`, `sort_code`). */
export interface WiseRequirementGroup {
  readonly type: string;
  readonly title: string;
  readonly sections: readonly WiseRequirementSection[];
}

export interface WiseDepositDetails {
  readonly bankName: string | undefined;
  readonly accountHolder: string | undefined;
  /** Bank details to show the customer, as Wise labels them. */
  readonly items: readonly { readonly label: string; readonly value: string }[];
}
