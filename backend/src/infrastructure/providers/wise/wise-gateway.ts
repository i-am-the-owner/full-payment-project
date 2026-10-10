import type {
  WiseCurrency,
  WiseDepositDetails,
  WiseFundingResult,
  WiseProfile,
  WiseQuote,
  WiseRecipient,
  WiseRequirementGroup,
  WiseTransfer,
} from './wise-models.ts';

export interface CreateQuoteInput {
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  /** Exactly one of sourceAmountMinor / targetAmountMinor. */
  readonly sourceAmountMinor?: bigint;
  readonly targetAmountMinor?: bigint;
  readonly payOut?: string;
  /** Link the quote to a recipient so per-route fees are accurate. */
  readonly targetAccountId?: string;
}

export interface CreateRecipientBankAccountInput {
  readonly currency: string;
  readonly accountHolderName: string;
  readonly legalType: 'PRIVATE' | 'BUSINESS';
  /** GBP sort-code account. */
  readonly sortCode?: string | undefined;
  readonly accountNumber?: string | undefined;
  /** IBAN account (non-GBP routes). */
  readonly iban?: string | undefined;
}

export interface CreateTransferInput {
  readonly quoteId: string;
  readonly targetAccountId: string;
  /**
   * The idempotency key. Wise stores it as `customerTransactionId` and will not
   * create a second transfer for a repeated key.
   */
  readonly idempotencyKey: string;
  readonly reference?: string;
  /** Answers to Wise's transfer requirements (e.g. `transferPurpose`), by Wise key. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RequirementsRequest {
  /** The recipient account type to ask about (`iban`, `sort_code`, ...). */
  readonly type?: string | undefined;
  readonly accountHolderName?: string | undefined;
  /** Values entered so far, nested the way Wise expects (`address: { country }`). */
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface CreateRecipientInput {
  readonly currency: string;
  readonly type: string;
  readonly accountHolderName: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The raw Wise Platform API surface, in Wise's own vocabulary. It is internal to
 * the Wise adapter: the rest of the app only ever sees `PayoutProvider`.
 *
 * Every method throws a `WiseError` on failure – never a raw HTTP status or
 * Wise error body.
 */
export interface WiseGateway {
  /** Currencies Wise can send. */
  listCurrencies(): Promise<WiseCurrency[]>;
  /** The profiles the token can act for. */
  listProfiles(): Promise<WiseProfile[]>;

  /**
   * What a recipient needs for the quote's corridor. Without `request` it is a
   * GET; with the values so far it is the documented POST that re-queries.
   */
  getAccountRequirements(
    quoteId: string,
    request?: RequirementsRequest,
  ): Promise<WiseRequirementGroup[]>;
  createRecipient(input: CreateRecipientInput): Promise<WiseRecipient>;
  /** Prices the quote for a recipient (`PATCH` of `targetAccount`). */
  updateQuote(quoteId: string, targetAccountId: string): Promise<WiseQuote>;
  /** The extra questions Wise needs for a transfer. */
  getTransferRequirements(input: {
    quoteId: string;
    targetAccountId: string;
    details: Readonly<Record<string, unknown>>;
  }): Promise<WiseRequirementGroup[]>;
  /** Where the customer pays for a transfer by bank transfer. */
  getDepositDetails(transferId: string): Promise<WiseDepositDetails>;

  createQuote(input: CreateQuoteInput): Promise<WiseQuote>;

  createRecipientBankAccount(input: CreateRecipientBankAccountInput): Promise<WiseRecipient>;

  createTransfer(input: CreateTransferInput): Promise<WiseTransfer>;
  getTransfer(transferId: string): Promise<WiseTransfer>;
  cancelTransfer(transferId: string): Promise<WiseTransfer>;

  /** Funds the transfer from SomPay's Wise balance. May require SCA. */
  fundTransferFromBalance(transferId: string): Promise<WiseFundingResult>;

  /**
   * Sandbox-only: drives a transfer to the next lifecycle state. Throws in any
   * non-sandbox configuration.
   */
  simulateTransferTransition(transferId: string, toStatus: string): Promise<WiseTransfer>;
}
