import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CreateQuoteParams,
  CreateRecipientParams,
  CreateTransferParams,
  PayoutProvider,
  RecipientFormParams,
} from '../../../application/payout/payout-provider.ts';
import {
  CustomerNotVerifiedError,
  DuplicateError,
  InsufficientFundsError,
  NeedsRelinkError,
  ProviderRejectedError,
  QuoteExpiredError,
  RouteNotSupportedError,
  ValidationFailedError,
} from '../../../domain/payout/errors.ts';
import type {
  Capabilities,
  Currency,
  CustomerStatus,
  DynamicForm,
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
  WebhookHeaders,
} from '../../../domain/payout/models.ts';
import {
  accountSummary,
  COUNTRIES_BY_CURRENCY,
  recipientForm,
  transferForm,
  validateForm,
} from './mock-forms.ts';
import {
  isMockTransferStatus,
  mapMockStatus,
  type MockTransferStatus,
} from './mock-status-mapping.ts';

const CURRENCIES: readonly Currency[] = [
  { code: 'GBP', name: 'Pound sterling', minorUnit: 2 },
  { code: 'EUR', name: 'Euro', minorUnit: 2 },
  { code: 'USD', name: 'US dollar', minorUnit: 2 },
  { code: 'INR', name: 'Indian rupee', minorUnit: 2 },
  { code: 'NGN', name: 'Nigerian naira', minorUnit: 2 },
  { code: 'PHP', name: 'Philippine peso', minorUnit: 2 },
  { code: 'MXN', name: 'Mexican peso', minorUnit: 2 },
];
const SOURCE_CURRENCIES = ['GBP', 'EUR', 'USD'];

/** Fixed, made-up rates: units of the currency per 1 GBP, in millionths. */
const PER_GBP_MICROS: Readonly<Record<string, bigint>> = {
  GBP: 1_000_000n,
  EUR: 1_170_000n,
  USD: 1_270_000n,
  INR: 105_500_000n,
  NGN: 1_950_000_000n,
  PHP: 72_400_000n,
  MXN: 23_100_000n,
};
const MICRO = 1_000_000n;

const QUOTE_TTL_MS = 30 * 60 * 1000;
const FEE_FIXED_MINOR = 50n; // 0.50 in the source currency
const FEE_PER_MILLE = 4n; // 0.4 %
const MIN_SOURCE_MINOR = 100n; // 1.00
const MAX_SOURCE_MINOR = 100_000_000n; // 1,000,000.00
const BUSINESS_RECIPIENT_FEE_MINOR = 50n; // paying a business costs 0.50 more
const SCA_THRESHOLD_MINOR = 500_000n; // balance funding above 5,000.00 needs SCA
const BALANCE_LIMIT_MINOR = 2_000_000n; // the mock balance holds 20,000.00

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';
const SIGNATURE_HEADER = MOCK_SIGNATURE_HEADER;

/** How the mock signs a webhook body. Shared with the dev script that sends them. */
export function signMockWebhookBody(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function mapMockCustomerStatus(status: string): CustomerStatus | null {
  switch (status) {
    case 'verified':
      return 'VERIFIED';
    case 'pending':
      return 'PENDING';
    case 'rejected':
      return 'REJECTED';
    case 'needs_relink':
      return 'NEEDS_RELINK';
    default:
      return null;
  }
}

/** The happy path the dev "advance" endpoint walks a transfer along. */
const NEXT_STATUS: Partial<Record<MockTransferStatus, MockTransferStatus>> = {
  pending_funding: 'funded',
  funded: 'paid_out',
  paid_out: 'delivered',
};

interface StoredQuote {
  readonly id: string;
  readonly rate: string;
  readonly rateMicros: bigint;
  /** The fee before any recipient-specific charge. */
  readonly baseFee: Money;
  fee: Money;
  readonly sourceAmount: Money;
  targetAmount: Money;
  readonly expiresAt: Date;
  readonly estimatedDelivery: Date | undefined;
  readonly customerRef: string;
  usedByTransferId: string | undefined;
}
interface StoredRecipient extends PayoutRecipient {
  readonly customerRef: string;
  readonly isBusiness: boolean;
}
interface StoredTransfer {
  readonly id: string;
  readonly customerRef: string;
  readonly quoteId: string;
  readonly idempotencyKey: string;
  readonly reference: string;
  readonly sourceAmount: Money;
  status: MockTransferStatus;
}

export interface SignedWebhook {
  readonly headers: WebhookHeaders;
  readonly rawBody: Buffer;
}

export interface MockPayoutProviderOptions {
  readonly clock?: () => Date;
  /** HMAC secret for the fake webhooks. Random per process when omitted. */
  readonly webhookSecret?: string;
  /** Approve new customers at once instead of showing the mock identity page. */
  readonly skipIdentityCheck?: boolean;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function formatRate(micros: bigint): string {
  const whole = micros / MICRO;
  const fraction = (micros % MICRO).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/**
 * A complete in-process payout provider with no external dependencies, so the
 * whole app runs with `PAYOUT_PROVIDER=mock` and no credentials.
 *
 * It behaves like a real provider where it matters: quotes expire after 30
 * minutes, each currency has its own recipient form, values are validated,
 * idempotency keys are honoured, and status changes arrive as HMAC-signed
 * webhooks. Quotes, recipients and transfers live in memory and are lost on
 * restart; customer status is derived from the customer reference, so it
 * survives one.
 *
 * Test hooks: an email containing `+pending`, `+rejected` or `+relink` before
 * the `@` onboards with that status instead of VERIFIED.
 */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'mock' as const;

  readonly #clock: () => Date;
  readonly #webhookSecret: string;
  readonly #skipIdentityCheck: boolean;
  readonly #quotes = new Map<string, StoredQuote>();
  readonly #recipients = new Map<string, StoredRecipient>();
  readonly #transfers = new Map<string, StoredTransfer>();
  readonly #transferIdByKey = new Map<string, string>();

  constructor(options: MockPayoutProviderOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#webhookSecret = options.webhookSecret ?? randomBytes(32).toString('hex');
    this.#skipIdentityCheck = options.skipIdentityCheck ?? false;
  }

  getCapabilities(): Promise<Capabilities> {
    return Promise.resolve({
      provider: this.name,
      sourceCurrencies: SOURCE_CURRENCIES,
      targetCurrencies: CURRENCIES.map((currency) => currency.code),
      features: {
        // A stand-in for a provider-hosted identity check (a dev-only page).
        needsCustomerRedirectForKyc: !this.#skipIdentityCheck,
        fundingMethods: ['BANK_TRANSFER', 'BALANCE'],
      },
      senderCountries: ['GB'],
      payoutCountries: COUNTRIES_BY_CURRENCY,
      unsupportedOperations: [],
    });
  }

  // --- Customers -----------------------------------------------------------

  /**
   * Sends the customer to the mock "identity check" page (a dev-only page
   * served by this backend), which then returns them to `returnUrl` with the
   * outcome they picked – the same round trip a real hosted KYC flow makes.
   */
  startCustomerOnboarding(
    user: OnboardingUser,
    context: OnboardingContext,
  ): Promise<OnboardingStart> {
    if (this.#skipIdentityCheck) return Promise.resolve({ kind: 'done' });
    const page = new URL('/dev/mock/kyc', context.returnUrl);
    page.searchParams.set('return_url', context.returnUrl);
    return Promise.resolve({
      kind: 'redirect',
      url: page.toString(),
      link: { provider: this.name, customerRef: `mock-pending-${user.id}` },
    });
  }

  /**
   * `mock_outcome` (approved / pending / rejected / relink) comes from the mock
   * identity page. Without it, an email containing `+pending`, `+rejected` or
   * `+relink` picks the outcome, and anything else is approved.
   *
   * The mock reports the customer's own profile as the verified identity,
   * unless the email contains `+mismatch`, in which case it reports a different
   * date of birth so the identity check can be exercised.
   */
  completeCustomerOnboarding(
    user: OnboardingUser,
    callbackParams: Readonly<Record<string, string>> = {},
  ): Promise<CompletedOnboarding> {
    const local = user.email.split('@')[0] ?? '';
    const outcome = callbackParams.mock_outcome;
    const status: CustomerStatus =
      outcome === 'pending' || (!outcome && local.includes('+pending'))
        ? 'PENDING'
        : outcome === 'rejected' || (!outcome && local.includes('+rejected'))
          ? 'REJECTED'
          : outcome === 'relink' || (!outcome && local.includes('+relink'))
            ? 'NEEDS_RELINK'
            : 'VERIFIED';
    const profile = user.profile;
    return Promise.resolve({
      link: { provider: this.name, customerRef: `mock-${status.toLowerCase()}-${user.id}` },
      ...(status === 'VERIFIED' && profile
        ? {
            verifiedIdentity: {
              firstName: profile.firstName,
              lastName: profile.lastName,
              dateOfBirth: local.includes('+mismatch') ? '1901-01-01' : profile.dateOfBirth,
            },
          }
        : {}),
    });
  }

  getCustomerStatus(link: ProviderCustomerLink): Promise<CustomerStatus> {
    return Promise.resolve(this.#statusOf(link));
  }

  // --- Pricing -------------------------------------------------------------

  listCurrencies(): Promise<Currency[]> {
    return Promise.resolve([...CURRENCIES]);
  }

  createQuote(params: CreateQuoteParams): Promise<PayoutQuote> {
    return this.#run(() => {
      this.#requireVerified(params.link);
      const sourceRate = PER_GBP_MICROS[params.sourceCurrency];
      const targetRate = PER_GBP_MICROS[params.targetCurrency];
      if (
        !SOURCE_CURRENCIES.includes(params.sourceCurrency) ||
        sourceRate === undefined ||
        targetRate === undefined
      ) {
        throw new RouteNotSupportedError(
          `The mock provider does not send ${params.sourceCurrency} to ${params.targetCurrency}.`,
        );
      }
      const hasSource = params.sourceAmountMinor !== undefined;
      const hasTarget = params.targetAmountMinor !== undefined;
      if (hasSource === hasTarget) {
        throw new ValidationFailedError([
          { field: 'sourceAmount', message: 'Give either a source amount or a target amount' },
        ]);
      }

      // All mock currencies have two minor digits, so minor units convert 1:1.
      const rateMicros = (targetRate * MICRO) / sourceRate;
      let source: bigint;
      let fee: bigint;
      let target: bigint;
      if (params.sourceAmountMinor !== undefined) {
        source = params.sourceAmountMinor;
        fee = (source * FEE_PER_MILLE) / 1000n + FEE_FIXED_MINOR;
        target = ((source - fee) * rateMicros) / MICRO;
      } else {
        target = params.targetAmountMinor ?? 0n;
        const principal = ceilDiv(target * MICRO, rateMicros);
        source = ceilDiv((principal + FEE_FIXED_MINOR) * 1000n, 1000n - FEE_PER_MILLE);
        fee = source - principal;
      }
      if (source < MIN_SOURCE_MINOR || source > MAX_SOURCE_MINOR || target <= 0n) {
        throw new ValidationFailedError([
          {
            field: hasSource ? 'sourceAmount' : 'targetAmount',
            message: 'The amount is outside the range this provider accepts',
          },
        ]);
      }

      const now = this.#clock();
      const quote: StoredQuote = {
        id: `mock-quote-${randomUUID()}`,
        rate: formatRate(rateMicros),
        rateMicros,
        baseFee: { currency: params.sourceCurrency, amountMinor: fee },
        fee: { currency: params.sourceCurrency, amountMinor: fee },
        sourceAmount: { currency: params.sourceCurrency, amountMinor: source },
        targetAmount: { currency: params.targetCurrency, amountMinor: target },
        expiresAt: new Date(now.getTime() + QUOTE_TTL_MS),
        estimatedDelivery: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        customerRef: params.link.customerRef,
        usedByTransferId: undefined,
      };
      this.#quotes.set(quote.id, quote);
      return toQuote(quote);
    });
  }

  // --- Recipients ----------------------------------------------------------

  getRecipientForm(params: RecipientFormParams): Promise<DynamicForm> {
    return this.#run(() => {
      this.#requireVerified(params.link);
      this.#requireRoute(params.currency, params.country);
      return recipientForm(params.currency, params.partialValues);
    });
  }

  createRecipient(params: CreateRecipientParams): Promise<PayoutRecipient> {
    return this.#run(() => {
      this.#requireVerified(params.link);
      this.#requireRoute(params.currency, params.country);
      validateForm(recipientForm(params.currency, params.values), params.values);

      const recipient: StoredRecipient = {
        id: `mock-recipient-${randomUUID()}`,
        name: (params.values.accountHolderName ?? '').trim(),
        currency: params.currency,
        country: params.country,
        accountSummary: accountSummary(params.currency, params.values),
        customerRef: params.link.customerRef,
        isBusiness: params.values.legalType === 'BUSINESS',
      };
      this.#recipients.set(recipient.id, recipient);
      return toRecipient(recipient);
    });
  }

  /**
   * Re-prices the quote for the recipient, as real providers can. Paying a
   * business costs a little more, so the recipient receives a little less; a
   * person costs the fee originally quoted. Unused quotes only.
   */
  updateQuoteWithRecipient(params: {
    link: ProviderCustomerLink;
    quote: PayoutQuote;
    recipient: PayoutRecipient;
  }): Promise<PayoutQuote> {
    return this.#run(() => {
      this.#requireVerified(params.link);
      const quote = this.#liveQuote(params.link, params.quote.id);
      const recipient = this.#ownRecipient(params.link, params.recipient.id, quote);
      if (quote.usedByTransferId === undefined) {
        const fee =
          quote.baseFee.amountMinor + (recipient.isBusiness ? BUSINESS_RECIPIENT_FEE_MINOR : 0n);
        quote.fee = { currency: quote.fee.currency, amountMinor: fee };
        quote.targetAmount = {
          currency: quote.targetAmount.currency,
          amountMinor: ((quote.sourceAmount.amountMinor - fee) * quote.rateMicros) / MICRO,
        };
      }
      return toQuote(quote);
    });
  }

  // --- Transfers -----------------------------------------------------------

  getTransferForm(params: {
    link: ProviderCustomerLink;
    quote: PayoutQuote;
    recipient: PayoutRecipient;
  }): Promise<DynamicForm> {
    return this.#run(() => {
      this.#requireVerified(params.link);
      return transferForm(params.quote.targetAmount.currency);
    });
  }

  createTransfer(params: CreateTransferParams): Promise<PayoutTransfer> {
    return this.#run(() => {
      this.#requireVerified(params.link);

      // An idempotent replay returns the transfer that already exists.
      const existingId = this.#transferIdByKey.get(params.idempotencyKey);
      if (existingId !== undefined) {
        const existing = this.#transfers.get(existingId);
        if (existing && existing.quoteId === params.quote.id) {
          return toTransfer(existing);
        }
        throw new DuplicateError('That idempotency key was already used for another transfer.');
      }

      const quote = this.#liveQuote(params.link, params.quote.id);
      if (quote.usedByTransferId !== undefined) {
        throw new DuplicateError('That quote was already used for a transfer.');
      }
      this.#ownRecipient(params.link, params.recipient.id, quote);
      validateForm(transferForm(quote.targetAmount.currency), params.answers);

      const transfer: StoredTransfer = {
        id: `mock-transfer-${randomUUID()}`,
        customerRef: params.link.customerRef,
        quoteId: quote.id,
        idempotencyKey: params.idempotencyKey,
        reference: params.reference,
        sourceAmount: quote.sourceAmount,
        status: 'pending_funding',
      };
      quote.usedByTransferId = transfer.id;
      this.#transfers.set(transfer.id, transfer);
      this.#transferIdByKey.set(params.idempotencyKey, transfer.id);
      return toTransfer(transfer);
    });
  }

  /** How many transfers the mock provider holds. For tests and the dev tools. */
  get transferCount(): number {
    return this.#transfers.size;
  }

  findTransferByIdempotencyKey(params: {
    link: ProviderCustomerLink;
    idempotencyKey: string;
  }): Promise<PayoutTransfer | null> {
    return this.#run(() => {
      const id = this.#transferIdByKey.get(params.idempotencyKey);
      const transfer = id === undefined ? undefined : this.#transfers.get(id);
      return transfer && transfer.customerRef === params.link.customerRef
        ? toTransfer(transfer)
        : null;
    });
  }

  getFundingInstructions(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
  }): Promise<FundingInstructions[]> {
    return this.#run(() => {
      const transfer = this.#ownTransfer(params.link, params.transfer.id);
      return [
        {
          method: 'BANK_TRANSFER',
          amount: transfer.sourceAmount,
          bankDetails: [
            { label: 'Account holder', value: 'Mock Payments Ltd (sandbox)' },
            { label: 'Bank', value: 'Mock Bank' },
            { label: 'Sort code', value: '00-00-00' },
            { label: 'Account number', value: '00000000' },
          ],
          // The provider's own reference for matching the incoming payment.
          reference: `MOCK${transfer.id.slice(-8).toUpperCase()}`,
        },
        { method: 'BALANCE', amount: transfer.sourceAmount },
      ];
    });
  }

  fundTransfer(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
    method: FundingMethod;
  }): Promise<FundingResult> {
    return this.#run((): FundingResult => {
      const transfer = this.#ownTransfer(params.link, params.transfer.id);
      if (transfer.status !== 'pending_funding') {
        return { status: 'REJECTED', errorCode: 'transfer.not_awaiting_funds' };
      }
      if (params.method === 'BANK_TRANSFER') {
        // The customer pays by bank transfer outside the API; nothing to do yet.
        return { status: 'PENDING', errorCode: undefined };
      }
      if (transfer.sourceAmount.amountMinor > BALANCE_LIMIT_MINOR) {
        throw new InsufficientFundsError();
      }
      if (transfer.sourceAmount.amountMinor > SCA_THRESHOLD_MINOR) {
        return { status: 'SCA_REQUIRED', errorCode: undefined };
      }
      transfer.status = 'funded';
      return { status: 'COMPLETED', errorCode: undefined };
    });
  }

  getTransfer(params: {
    link: ProviderCustomerLink;
    transferRef: string;
  }): Promise<PayoutTransfer> {
    return this.#run(() => toTransfer(this.#ownTransfer(params.link, params.transferRef)));
  }

  cancelTransfer(params: { link: ProviderCustomerLink; transfer: PayoutTransfer }): Promise<void> {
    return this.#run(() => {
      const transfer = this.#ownTransfer(params.link, params.transfer.id);
      if (transfer.status !== 'pending_funding') {
        throw new ProviderRejectedError('A transfer can only be cancelled before it is funded.');
      }
      transfer.status = 'cancelled';
    });
  }

  // --- Webhooks ------------------------------------------------------------

  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): boolean {
    const given = headers[SIGNATURE_HEADER];
    if (!given) {
      return false;
    }
    const expected = Buffer.from(this.#sign(rawBody), 'hex');
    const actual = Buffer.from(given, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  parseWebhook(rawBody: Buffer): NormalisedEvent {
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody.toString('utf8'));
    } catch {
      raw = undefined;
    }
    const body = (raw ?? {}) as {
      event?: unknown;
      event_id?: unknown;
      transfer_id?: unknown;
      customer_ref?: unknown;
      status?: unknown;
      occurred_at?: unknown;
    };
    const occurredAt =
      typeof body.occurred_at === 'string' ? new Date(body.occurred_at) : undefined;
    if (
      body.event === 'customer.updated' &&
      typeof body.customer_ref === 'string' &&
      typeof body.status === 'string' &&
      occurredAt &&
      !Number.isNaN(occurredAt.getTime())
    ) {
      return {
        type: 'customer.status_changed',
        providerTransferId: undefined,
        newStatus: null,
        providerStatus: body.status,
        eventId: typeof body.event_id === 'string' ? body.event_id : undefined,
        occurredAt,
        raw,
        providerCustomerRef: body.customer_ref,
        newCustomerStatus: mapMockCustomerStatus(body.status),
      };
    }
    if (
      body.event !== 'transfer.updated' ||
      typeof body.transfer_id !== 'string' ||
      typeof body.status !== 'string' ||
      !occurredAt ||
      Number.isNaN(occurredAt.getTime())
    ) {
      return {
        type: 'unknown',
        providerTransferId: undefined,
        newStatus: null,
        providerStatus: undefined,
        eventId: undefined,
        occurredAt: this.#clock(),
        raw,
      };
    }
    return {
      type: 'transfer.status_changed',
      providerTransferId: body.transfer_id,
      newStatus: mapMockStatus(body.status),
      providerStatus: body.status,
      eventId: typeof body.event_id === 'string' ? body.event_id : undefined,
      occurredAt,
      raw,
    };
  }

  // --- Dev / test controls (not part of PayoutProvider) --------------------

  /**
   * Moves a transfer to its next status (or to `to`) and returns the signed
   * webhook a real provider would send. Used by the dev-only endpoint and tests.
   */
  advanceTransfer(providerTransferId: string, to?: string, occurredAt?: Date): SignedWebhook {
    const transfer = this.#transfers.get(providerTransferId);
    if (!transfer) {
      throw new ProviderRejectedError('The mock provider has no such transfer.');
    }
    const next = to ?? NEXT_STATUS[transfer.status];
    if (!isMockTransferStatus(next)) {
      throw new ValidationFailedError([
        { field: 'status', message: `Cannot advance a transfer that is "${transfer.status}"` },
      ]);
    }
    transfer.status = next;
    return this.signWebhook({
      event: 'transfer.updated',
      event_id: randomUUID(),
      transfer_id: transfer.id,
      status: transfer.status,
      occurred_at: (occurredAt ?? this.#clock()).toISOString(),
    });
  }

  /**
   * A signed webhook announcing `status` for a transfer WITHOUT changing the
   * transfer at the mock provider. For testing out-of-order and repeated
   * delivery: give an earlier `occurredAt`, or reuse an `eventId`.
   */
  simulateTransferEvent(
    providerTransferId: string,
    status: MockTransferStatus,
    options: { occurredAt?: Date; eventId?: string } = {},
  ): SignedWebhook {
    return this.signWebhook({
      event: 'transfer.updated',
      event_id: options.eventId ?? randomUUID(),
      transfer_id: providerTransferId,
      status,
      occurred_at: (options.occurredAt ?? this.#clock()).toISOString(),
    });
  }

  /** A signed webhook announcing a change of a customer's verification status. */
  simulateCustomerStatus(
    customerRef: string,
    status: 'verified' | 'pending' | 'rejected' | 'needs_relink',
    options: { occurredAt?: Date; eventId?: string } = {},
  ): SignedWebhook {
    return this.signWebhook({
      event: 'customer.updated',
      event_id: options.eventId ?? randomUUID(),
      customer_ref: customerRef,
      status,
      occurred_at: (options.occurredAt ?? this.#clock()).toISOString(),
    });
  }

  /** Signs an arbitrary payload exactly as the mock signs its own webhooks. */
  signWebhook(payload: unknown): SignedWebhook {
    const rawBody = Buffer.from(JSON.stringify(payload));
    return { headers: { [SIGNATURE_HEADER]: this.#sign(rawBody) }, rawBody };
  }

  // --- Internals -----------------------------------------------------------

  #sign(rawBody: Buffer): string {
    return signMockWebhookBody(this.#webhookSecret, rawBody);
  }

  /** Runs synchronous mock logic as a promise, so throws become rejections. */
  #run<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #statusOf(link: ProviderCustomerLink): CustomerStatus {
    if (link.provider !== this.name) {
      return 'NEEDS_RELINK';
    }
    const match = /^mock-(pending|verified|rejected|needs_relink)-/.exec(link.customerRef);
    return match ? (match[1]!.toUpperCase() as CustomerStatus) : 'NEEDS_RELINK';
  }

  #requireVerified(link: ProviderCustomerLink): void {
    const status = this.#statusOf(link);
    if (status === 'NEEDS_RELINK') {
      throw new NeedsRelinkError();
    }
    if (status !== 'VERIFIED') {
      throw new CustomerNotVerifiedError();
    }
  }

  #requireRoute(currency: string, country: string): void {
    const countries = COUNTRIES_BY_CURRENCY[currency];
    if (!countries?.includes(country)) {
      throw new RouteNotSupportedError(
        `The mock provider does not pay out ${currency} in ${country}.`,
      );
    }
  }

  #liveQuote(link: ProviderCustomerLink, quoteId: string): StoredQuote {
    const quote = this.#quotes.get(quoteId);
    if (!quote || quote.customerRef !== link.customerRef) {
      throw new QuoteExpiredError('That quote is not known to the provider.');
    }
    if (quote.expiresAt.getTime() <= this.#clock().getTime()) {
      throw new QuoteExpiredError();
    }
    return quote;
  }

  #ownRecipient(
    link: ProviderCustomerLink,
    recipientId: string,
    quote: StoredQuote,
  ): StoredRecipient {
    const recipient = this.#recipients.get(recipientId);
    if (!recipient || recipient.customerRef !== link.customerRef) {
      throw new ValidationFailedError([{ field: 'recipient', message: 'Unknown recipient' }]);
    }
    if (recipient.currency !== quote.targetAmount.currency) {
      throw new ValidationFailedError([
        { field: 'recipient', message: 'The recipient currency does not match the quote' },
      ]);
    }
    return recipient;
  }

  #ownTransfer(link: ProviderCustomerLink, transferId: string): StoredTransfer {
    const transfer = this.#transfers.get(transferId);
    if (!transfer || transfer.customerRef !== link.customerRef) {
      throw new ProviderRejectedError('The provider has no such transfer for this customer.');
    }
    return transfer;
  }
}

function toQuote(quote: StoredQuote): PayoutQuote {
  return {
    id: quote.id,
    rate: quote.rate,
    fee: quote.fee,
    sourceAmount: quote.sourceAmount,
    targetAmount: quote.targetAmount,
    expiresAt: quote.expiresAt,
    estimatedDelivery: quote.estimatedDelivery,
  };
}

function toRecipient(recipient: StoredRecipient): PayoutRecipient {
  return {
    id: recipient.id,
    name: recipient.name,
    currency: recipient.currency,
    country: recipient.country,
    accountSummary: recipient.accountSummary,
  };
}

function toTransfer(transfer: StoredTransfer): PayoutTransfer {
  return {
    id: transfer.id,
    status: mapMockStatus(transfer.status),
    providerStatus: transfer.status,
    reference: transfer.reference,
  };
}
