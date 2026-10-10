import type {
  Capabilities,
  Currency,
  CustomerStatus,
  DynamicForm,
  FormValues,
  FundingInstructions,
  FundingMethod,
  FundingResult,
  Money,
  CompletedOnboarding,
  NormalisedEvent,
  OnboardingContext,
  OnboardingStart,
  OnboardingUser,
  PayoutQuote,
  PayoutRecipient,
  PayoutTransfer,
  ProviderCustomerLink,
  ProviderName,
  WebhookHeaders,
} from '../../domain/payout/models.ts';

export interface CreateQuoteParams {
  readonly link: ProviderCustomerLink;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  /** Exactly one of the two amounts is given, in minor units. */
  readonly sourceAmountMinor?: bigint;
  readonly targetAmountMinor?: bigint;
}

export interface RecipientFormParams {
  readonly link: ProviderCustomerLink;
  /** Either the quote the recipient is for, or just its currency. */
  readonly quote?: PayoutQuote;
  readonly currency: string;
  readonly country: string;
  /** Values entered so far, for fields flagged `refreshOnChange`. */
  readonly partialValues?: FormValues;
}

export interface CreateRecipientParams {
  readonly link: ProviderCustomerLink;
  readonly currency: string;
  readonly country: string;
  readonly values: FormValues;
}

export interface CreateTransferParams {
  readonly link: ProviderCustomerLink;
  readonly quote: PayoutQuote;
  readonly recipient: PayoutRecipient;
  /** Answers to {@link PayoutProvider.getTransferForm}. */
  readonly answers: FormValues;
  /** SomPay's own UUID, created once and reused on every retry. */
  readonly idempotencyKey: string;
  readonly reference: string;
}

/**
 * The single seam between SomPay and a licensed payout provider. Application
 * code depends on this interface only; concrete providers live under
 * `infrastructure/providers/` and are chosen by `PAYOUT_PROVIDER`.
 *
 * Failures are thrown as the typed errors in `domain/payout/errors.ts`.
 */
export interface PayoutProvider {
  readonly name: ProviderName;

  getCapabilities(): Promise<Capabilities>;

  // --- Customers (provider-hosted KYC / account linking) ---
  startCustomerOnboarding(
    user: OnboardingUser,
    context: OnboardingContext,
  ): Promise<OnboardingStart>;
  /**
   * `callbackParams` are the query parameters the provider sent back through
   * the customer's browser. They are untrusted input.
   */
  completeCustomerOnboarding(
    user: OnboardingUser,
    callbackParams: Readonly<Record<string, string>>,
  ): Promise<CompletedOnboarding>;
  getCustomerStatus(link: ProviderCustomerLink): Promise<CustomerStatus>;

  // --- Pricing ---
  listCurrencies(): Promise<Currency[]>;
  createQuote(params: CreateQuoteParams): Promise<PayoutQuote>;

  // --- Recipients ---
  getRecipientForm(params: RecipientFormParams): Promise<DynamicForm>;
  createRecipient(params: CreateRecipientParams): Promise<PayoutRecipient>;
  updateQuoteWithRecipient(params: {
    link: ProviderCustomerLink;
    quote: PayoutQuote;
    recipient: PayoutRecipient;
  }): Promise<PayoutQuote>;

  // --- Transfers ---
  getTransferForm(params: {
    link: ProviderCustomerLink;
    quote: PayoutQuote;
    recipient: PayoutRecipient;
    /** Answers so far, for fields flagged `refreshOnChange`. */
    partialValues?: FormValues;
  }): Promise<DynamicForm>;
  createTransfer(params: CreateTransferParams): Promise<PayoutTransfer>;
  /**
   * Looks for a transfer created earlier with this idempotency key. Used after
   * a create whose outcome is unknown (timeout, network error), BEFORE any
   * retry. Resolves `null` when the provider has no such transfer. Throws
   * `NotSupportedError` when the provider has no such lookup; its
   * `createTransfer` must then itself be safe to repeat with the same key.
   */
  findTransferByIdempotencyKey(params: {
    link: ProviderCustomerLink;
    idempotencyKey: string;
  }): Promise<PayoutTransfer | null>;
  getFundingInstructions(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
    /** Everything the customer has to pay for this transfer, fee included. */
    amount: Money;
  }): Promise<FundingInstructions[]>;
  fundTransfer(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
    method: FundingMethod;
  }): Promise<FundingResult>;
  getTransfer(params: { link: ProviderCustomerLink; transferRef: string }): Promise<PayoutTransfer>;
  cancelTransfer(params: { link: ProviderCustomerLink; transfer: PayoutTransfer }): Promise<void>;

  // --- Webhooks ---
  /** True iff `rawBody` carries a valid signature from this provider. */
  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): boolean;
  /** Parses an already-verified body. Unrecognised events come back as `unknown`. */
  parseWebhook(rawBody: Buffer): NormalisedEvent;
}
