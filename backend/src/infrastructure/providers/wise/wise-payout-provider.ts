import type {
  CreateQuoteParams,
  CreateRecipientParams,
  CreateTransferParams,
  PayoutProvider,
  RecipientFormParams,
} from '../../../application/payout/payout-provider.ts';
import {
  DuplicateError,
  NeedsRelinkError,
  NotSupportedError,
  PayoutError,
  ProviderRejectedError,
  ProviderUnavailableError,
  ScaRequiredError,
  RouteNotSupportedError,
  ValidationFailedError,
} from '../../../domain/payout/errors.ts';
import type {
  Capabilities,
  CompletedOnboarding,
  Currency,
  CustomerStatus,
  DynamicForm,
  FundingInstructions,
  FundingMethod,
  FundingResult,
  Money,
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
import { iso4217MinorUnits } from '../iso-4217.ts';
import { WiseError } from './wise-errors.ts';
import {
  ACCOUNT_TYPE_KEY,
  nestDetails,
  recipientForm,
  recipientRequest,
  transferForm,
} from './wise-forms.ts';
import type { WiseGateway } from './wise-gateway.ts';
import type { WiseCurrency, WiseProfile, WiseQuote, WiseTransfer } from './wise-models.ts';
import { mapWiseKycState, mapWiseStatus } from './wise-status-mapping.ts';
import type { WiseUserTokenManager } from './wise-user-tokens.ts';
import type { RsaWiseWebhookVerifier } from './wise-webhook-verifier.ts';

/** Wise's currency list changes rarely: it is kept for 24 hours. */
const CURRENCY_CACHE_MS = 24 * 60 * 60 * 1000;

export interface WiseOAuthDeps {
  /** Where the customer authorises SomPay. Given by the Wise team. */
  readonly authorizeUrl: string;
  readonly clientId: string;
  /** The redirect URI registered with Wise; it must match the one used for the code exchange. */
  readonly redirectUri: string;
  readonly tokens: WiseUserTokenManager;
  /** Lists profiles with a freshly issued access token (before it is cached for a customer). */
  readonly listProfilesWith: (accessToken: string) => Promise<WiseProfile[]>;
}

export interface WisePayoutProviderDeps {
  /**
   * Returns the raw Wise API client for one customer's own Wise profile. There
   * is no shared SomPay profile: the profile id is always the customer's link.
   * `customerRef` lets partner OAuth pick that customer's own access token.
   */
  readonly clientFor: (profileId: string, customerRef?: string) => WiseGateway;
  readonly webhookVerifier: RsaWiseWebhookVerifier;
  /** `personal_token` (sandbox testing) or `oauth_partner` (not yet tested against Wise). */
  readonly mode?: 'personal_token' | 'oauth_partner';
  /** Client for calls that belong to no customer (the currency list). */
  readonly appClient?: () => WiseGateway;
  /** Currencies customers may pay in. */
  readonly sourceCurrencies?: readonly string[];
  readonly oauth?: WiseOAuthDeps;
  readonly clock?: () => Date;
}

/** Translates a Wise failure into SomPay's typed payout errors. */
export function toPayoutError(error: unknown): unknown {
  if (!(error instanceof WiseError)) {
    return error;
  }
  switch (error.code) {
    case 'wise_validation':
      if (error.details.some((d) => d.code === 'error.route.not.supported')) {
        return new RouteNotSupportedError();
      }
      return new ValidationFailedError(
        error.details.map((d) => ({ field: d.field ?? d.code, message: d.message })),
      );
    case 'wise_sca_required':
      return new ScaRequiredError();
    case 'wise_relink_required':
      return new NeedsRelinkError();
    case 'wise_conflict':
      return new DuplicateError();
    case 'wise_forbidden':
    case 'wise_not_found':
      return new ProviderRejectedError();
    case 'wise_auth':
    case 'wise_rate_limited':
      // The request was refused before it was processed: nothing happened.
      return new ProviderUnavailableError(undefined, { outcomeUnknown: false, cause: error });
    case 'wise_unavailable':
    case 'wise_timeout':
    case 'wise_unexpected':
      // No usable answer: the request may or may not have taken effect.
      return new ProviderUnavailableError(undefined, { outcomeUnknown: true, cause: error });
  }
}

function tail(value: string): string {
  return value.length >= 4 ? `••••${value.slice(-4)}` : '••••';
}

/** The customer's own personal Wise profile among those a token can act for. */
function personalProfile(profiles: readonly WiseProfile[]): WiseProfile | undefined {
  return profiles.find((p) => p.type === 'PERSONAL');
}

/**
 * Wise Platform behind the provider-neutral interface.
 *
 * Auth is pluggable (`WISE_AUTH_MODE`):
 *  - `personal_token`: a sandbox personal API token. It is ONE Wise account, so
 *    it stands in for every customer and is refused against a production host.
 *    Onboarding links that account; no redirect is needed.
 *  - `oauth_partner`: each customer authorises SomPay and gets their own
 *    tokens (refreshed on demand; a refresh Wise refuses means NEEDS_RELINK).
 *    Written from the docs and NOT YET TESTED against Wise.
 *
 * Every other operation is the same in both modes and goes through the Wise
 * API client for the customer's own profile.
 */
export class WisePayoutProvider implements PayoutProvider {
  readonly name = 'wise' as const;
  readonly #deps: WisePayoutProviderDeps;
  #currencies: { list: Currency[]; fetchedAt: number } | undefined;

  constructor(deps: WisePayoutProviderDeps) {
    this.#deps = deps;
  }

  get #mode(): 'personal_token' | 'oauth_partner' {
    return this.#deps.mode ?? 'personal_token';
  }

  #now(): number {
    return (this.#deps.clock ?? (() => new Date()))().getTime();
  }

  // --- Capabilities and currencies ------------------------------------------

  async getCapabilities(): Promise<Capabilities> {
    const currencies = await this.listCurrencies();
    const oauth = this.#mode === 'oauth_partner';
    return {
      provider: this.name,
      sourceCurrencies: this.#deps.sourceCurrencies ?? ['GBP'],
      targetCurrencies: currencies.map((c) => c.code),
      features: {
        needsCustomerRedirectForKyc: oauth,
        // A personal token cannot fund from balance in the UK/EU (PSD2): the customer
        // pays by bank transfer. Partner OAuth may offer balance.
        fundingMethods: oauth ? ['BANK_TRANSFER', 'BALANCE'] : ['BANK_TRANSFER'],
      },
      unsupportedOperations: [],
    };
  }

  async listCurrencies(): Promise<Currency[]> {
    const cached = this.#currencies;
    if (cached && this.#now() - cached.fetchedAt < CURRENCY_CACHE_MS) {
      return [...cached.list];
    }
    let wise: WiseCurrency[];
    try {
      wise = await this.#app().listCurrencies();
    } catch (error) {
      throw toPayoutError(error);
    }
    const list: Currency[] = [];
    for (const currency of wise) {
      try {
        // No decimals: 0. Otherwise the ISO 4217 exponent; a code with no known
        // exponent is left out rather than guessed.
        const minorUnit = currency.supportsDecimals ? iso4217MinorUnits(currency.code) : 0;
        list.push({ code: currency.code, name: currency.name, minorUnit });
      } catch {
        continue;
      }
    }
    this.#currencies = { list, fetchedAt: this.#now() };
    return [...list];
  }

  // --- Customers ------------------------------------------------------------

  startCustomerOnboarding(
    _user: OnboardingUser,
    context: OnboardingContext,
  ): Promise<OnboardingStart> {
    const oauth = this.#deps.oauth;
    if (this.#mode === 'personal_token' || !oauth) {
      // The sandbox token IS the customer's account: nothing to authorise.
      return Promise.resolve({ kind: 'done' });
    }
    const state = new URL(context.returnUrl).searchParams.get('state');
    if (!state) {
      return Promise.reject(new ProviderRejectedError('The onboarding link has no state.'));
    }
    const url = new URL(oauth.authorizeUrl);
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', oauth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return Promise.resolve({ kind: 'redirect', url: url.toString() });
  }

  async completeCustomerOnboarding(
    _user: OnboardingUser,
    callbackParams: Readonly<Record<string, string>>,
  ): Promise<CompletedOnboarding> {
    const oauth = this.#deps.oauth;
    if (this.#mode === 'personal_token' || !oauth) {
      const profile = personalProfile(await this.#listProfiles(this.#app()));
      if (!profile) {
        throw new ProviderRejectedError('The Wise token has no personal profile.');
      }
      // Sandbox testing only: the token's own account stands in for the customer, so
      // there is no verified identity to compare with the profile they typed.
      return { link: { provider: this.name, customerRef: profile.id, profileRef: profile.id } };
    }

    if (callbackParams.error || !callbackParams.code) {
      throw new ProviderRejectedError('Wise did not give access. Please try connecting again.');
    }
    try {
      const tokens = await oauth.tokens.exchangeAuthorizationCode(
        callbackParams.code,
        oauth.redirectUri,
      );
      const profile = personalProfile(await oauth.listProfilesWith(tokens.accessToken));
      if (!profile) {
        throw new ProviderRejectedError('That Wise account has no personal profile.');
      }
      oauth.tokens.remember(profile.id, tokens);
      return {
        link: { provider: this.name, customerRef: profile.id, profileRef: profile.id },
        // Stored encrypted by SomPay. Never an access token.
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      throw toPayoutError(error);
    }
  }

  /**
   * The customer's status, from their Wise profile: a visible personal profile
   * means Wise has verified them (it will not open an account otherwise); a
   * deactivated one is refused; a profile that is not there any more means they
   * must connect again. Wise's `kyc-reviews#state-change` webhook refines it.
   */
  async getCustomerStatus(link: ProviderCustomerLink): Promise<CustomerStatus> {
    const profiles = await this.#call(link, (wise) => this.#listProfiles(wise));
    const profile = profiles.find((p) => p.id === (link.profileRef ?? link.customerRef));
    if (!profile) {
      return 'NEEDS_RELINK';
    }
    if (profile.currentState === 'VISIBLE') {
      return 'VERIFIED';
    }
    return profile.currentState === 'DEACTIVATED' ? 'REJECTED' : 'PENDING';
  }

  // --- Pricing and recipients -----------------------------------------------

  async createQuote(params: CreateQuoteParams): Promise<PayoutQuote> {
    const quote = await this.#call(params.link, (wise) =>
      wise.createQuote({
        sourceCurrency: params.sourceCurrency,
        targetCurrency: params.targetCurrency,
        ...(params.sourceAmountMinor !== undefined
          ? { sourceAmountMinor: params.sourceAmountMinor }
          : {}),
        ...(params.targetAmountMinor !== undefined
          ? { targetAmountMinor: params.targetAmountMinor }
          : {}),
        payOut: 'BANK_TRANSFER',
      }),
    );
    return toPayoutQuote(quote);
  }

  /**
   * Wise's own recipient form for the quote's corridor. A recipient can have
   * several kinds of account (`iban`, `sort_code`, ...): choosing one is a field
   * flagged `refreshOnChange`, as are Wise's own `refreshRequirementsOnChange`
   * fields; the form is then re-requested with the values so far.
   */
  async getRecipientForm(params: RecipientFormParams): Promise<DynamicForm> {
    if (!params.quote) {
      throw new ValidationFailedError([
        { field: 'quote', message: 'Get a quote before choosing a recipient' },
      ]);
    }
    const quoteId = params.quote.id;
    const partial = params.partialValues ?? {};
    const request = recipientRequest(partial);
    const asked = Object.keys(partial).length > 0;

    const requirements = (
      await this.#call(params.link, (wise) =>
        wise.getAccountRequirements(
          quoteId,
          asked
            ? {
                type: request.type,
                accountHolderName: request.accountHolderName || undefined,
                details: request.details,
              }
            : undefined,
        ),
      )
    )
      // Email recipients need Wise's agreement first and are not offered.
      .filter((r) => r.type !== 'email');
    if (requirements.length === 0) {
      throw new ValidationFailedError([
        { field: 'recipient', message: 'Wise cannot pay out to a bank account for this route' },
      ]);
    }
    const chosen =
      request.type && requirements.some((r) => r.type === request.type)
        ? request.type
        : requirements[0]!.type;
    return recipientForm(requirements, chosen);
  }

  async createRecipient(params: CreateRecipientParams): Promise<PayoutRecipient> {
    const request = recipientRequest(params.values);
    const problems = [];
    if (!request.type) {
      problems.push({
        field: ACCOUNT_TYPE_KEY,
        message: 'Choose how they will receive the money',
      });
    }
    if (request.accountHolderName.length < 2) {
      problems.push({ field: 'accountHolderName', message: 'Enter the account holder name' });
    }
    if (problems.length > 0 || !request.type) {
      throw new ValidationFailedError(problems);
    }
    const type = request.type;

    const created = await this.#call(params.link, (wise) =>
      wise.createRecipient({
        currency: params.currency,
        type,
        accountHolderName: request.accountHolderName,
        details: request.details,
      }),
    );
    const label = type === 'iban' ? 'IBAN' : 'Acct';
    return {
      id: created.id,
      name: created.accountHolderName || request.accountHolderName,
      currency: created.currency,
      country: created.country ?? params.country,
      // Only the tail: Wise keeps the full account details, SomPay never does.
      accountSummary: `${label} ${tail(created.accountTail ?? '')}`,
    };
  }

  /** Prices the quote for the recipient (Wise `PATCH` of `targetAccount`). The price can change. */
  async updateQuoteWithRecipient(params: {
    link: ProviderCustomerLink;
    quote: PayoutQuote;
    recipient: PayoutRecipient;
  }): Promise<PayoutQuote> {
    return toPayoutQuote(
      await this.#call(params.link, (wise) =>
        wise.updateQuote(params.quote.id, params.recipient.id),
      ),
    );
  }

  /** Wise's transfer requirements for this quote and recipient, as a form. */
  async getTransferForm(params: {
    link: ProviderCustomerLink;
    quote: PayoutQuote;
    recipient: PayoutRecipient;
    partialValues?: Readonly<Record<string, string>>;
  }): Promise<DynamicForm> {
    const groups = await this.#call(params.link, (wise) =>
      wise.getTransferRequirements({
        quoteId: params.quote.id,
        targetAccountId: params.recipient.id,
        details: nestDetails(params.partialValues ?? {}),
      }),
    );
    return transferForm(groups);
  }

  // --- Transfers ----------------------------------------------------------------

  /**
   * Creates the transfer with our UUID as Wise's `customerTransactionId`. Wise
   * documents no lookup by that id, so a create that got no answer is repeated
   * with the SAME id (never a new one) rather than looked up first.
   */
  async createTransfer(params: CreateTransferParams): Promise<PayoutTransfer> {
    const transfer = await this.#call(params.link, (wise) =>
      wise.createTransfer({
        quoteId: params.quote.id,
        targetAccountId: params.recipient.id,
        idempotencyKey: params.idempotencyKey,
        reference: params.reference,
        details: nestDetails(params.answers),
      }),
    );
    return toPayoutTransfer(transfer);
  }

  /**
   * Wise documents no lookup by `customerTransactionId`. Its create is safe to
   * repeat instead: sending the same `customerTransactionId` again returns the
   * transfer that already exists.
   */
  findTransferByIdempotencyKey(): Promise<never> {
    return Promise.reject(
      new NotSupportedError(
        'wise',
        'findTransferByIdempotencyKey',
        'resend the create with the same customerTransactionId',
      ),
    );
  }

  /**
   * How to pay for the transfer. By bank transfer: Wise's own bank details and
   * the payment reference `T<transfer id>` (Wise matches the incoming payment
   * with it). Paying from the customer's Wise balance is offered only with
   * partner OAuth.
   */
  async getFundingInstructions(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
    amount: Money;
  }): Promise<FundingInstructions[]> {
    const deposit = await this.#call(params.link, (wise) =>
      wise.getDepositDetails(params.transfer.id),
    );
    const bank: FundingInstructions = {
      method: 'BANK_TRANSFER',
      amount: params.amount,
      bankDetails: [
        ...(deposit.accountHolder
          ? [{ label: 'Account holder', value: deposit.accountHolder }]
          : []),
        ...(deposit.bankName ? [{ label: 'Bank', value: deposit.bankName }] : []),
        ...deposit.items,
      ],
      reference: `T${params.transfer.id}`,
    };
    return this.#mode === 'oauth_partner'
      ? [bank, { method: 'BALANCE', amount: params.amount }]
      : [bank];
  }

  /**
   * Bank transfer: nothing to do here, the customer pays Wise from their bank.
   * Balance: Wise takes it from the customer's own balance; a personal token
   * cannot do this in the UK/EU (PSD2), which comes back as a clean refusal so
   * the customer is shown the bank-transfer details instead.
   */
  async fundTransfer(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
    method: FundingMethod;
  }): Promise<FundingResult> {
    if (params.method === 'BANK_TRANSFER') {
      return { status: 'PENDING', errorCode: undefined };
    }
    try {
      const result = await this.#deps
        .clientFor(params.link.profileRef ?? params.link.customerRef, params.link.customerRef)
        .fundTransferFromBalance(params.transfer.id);
      return { status: result.status, errorCode: result.errorCode };
    } catch (error) {
      if (error instanceof WiseError) {
        if (
          this.#mode === 'personal_token' &&
          (error.code === 'wise_forbidden' || error.code === 'wise_sca_required')
        ) {
          return { status: 'REJECTED', errorCode: 'balance_funding_not_available' };
        }
        if (error.code === 'wise_sca_required') {
          return { status: 'SCA_REQUIRED', errorCode: undefined };
        }
      }
      throw toPayoutError(error);
    }
  }

  async getTransfer(params: {
    link: ProviderCustomerLink;
    transferRef: string;
  }): Promise<PayoutTransfer> {
    return toPayoutTransfer(
      await this.#call(params.link, (wise) => wise.getTransfer(params.transferRef)),
    );
  }

  async cancelTransfer(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
  }): Promise<void> {
    await this.#call(params.link, (wise) => wise.cancelTransfer(params.transfer.id));
  }

  /**
   * Sandbox only (not part of PayoutProvider): moves a funded sandbox transfer
   * to `state` with Wise's Simulation API, so Wise sends its real webhook. The
   * API client refuses this outside the sandbox.
   */
  async simulateTransferState(
    link: ProviderCustomerLink,
    transferId: string,
    state: string,
  ): Promise<WiseTransfer> {
    return this.#call(link, (wise) => wise.simulateTransferTransition(transferId, state));
  }

  // --- Webhooks -----------------------------------------------------------------

  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): boolean {
    return this.#deps.webhookVerifier.isValidSignature(rawBody, headers['x-signature-sha256']);
  }

  parseWebhook(rawBody: Buffer): NormalisedEvent {
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return unknownEvent(undefined);
    }
    if ((raw as { event_type?: unknown } | null)?.event_type === 'kyc-reviews#state-change') {
      try {
        const kyc = this.#deps.webhookVerifier.parseKycStateChange(rawBody);
        if (Number.isNaN(kyc.occurredAt.getTime())) {
          return unknownEvent(raw);
        }
        return {
          type: 'customer.status_changed',
          providerTransferId: undefined,
          newStatus: null,
          providerStatus: kyc.state,
          eventId: undefined,
          occurredAt: kyc.occurredAt,
          // Only what the adapter needs: the review's requirement details are not kept.
          raw: {
            event_type: 'kyc-reviews#state-change',
            data: { resource: { id: kyc.reviewId, state: kyc.state, profileId: kyc.profileId } },
          },
          providerCustomerRef: kyc.profileId,
          newCustomerStatus: mapWiseKycState(kyc.state),
        };
      } catch {
        return unknownEvent(raw);
      }
    }
    try {
      const event = this.#deps.webhookVerifier.parseTransferStateChange(rawBody, {});
      if (Number.isNaN(event.occurredAt.getTime())) {
        return unknownEvent(raw);
      }
      return {
        type: 'transfer.status_changed',
        providerTransferId: event.transferId,
        newStatus: mapWiseStatus(event.currentStatus),
        providerStatus: event.currentStatus,
        // Wise's delivery id travels in an unsigned header, so it is not used.
        eventId: undefined,
        occurredAt: event.occurredAt,
        raw,
      };
    } catch {
      return unknownEvent(raw);
    }
  }

  /** The client for calls that belong to no customer. */
  #app(): WiseGateway {
    return (this.#deps.appClient ?? (() => this.#deps.clientFor('0')))();
  }

  async #listProfiles(wise: WiseGateway): Promise<WiseProfile[]> {
    try {
      return await wise.listProfiles();
    } catch (error) {
      throw toPayoutError(error);
    }
  }

  async #call<T>(link: ProviderCustomerLink, fn: (wise: WiseGateway) => Promise<T>): Promise<T> {
    try {
      return await fn(this.#deps.clientFor(link.profileRef ?? link.customerRef, link.customerRef));
    } catch (error) {
      throw toPayoutError(error);
    }
  }
}

function unknownEvent(raw: unknown): NormalisedEvent {
  return {
    type: 'unknown',
    providerTransferId: undefined,
    newStatus: null,
    providerStatus: undefined,
    eventId: undefined,
    occurredAt: new Date(),
    raw,
  };
}

function toPayoutQuote(quote: WiseQuote): PayoutQuote {
  const expiresAt = quote.quoteExpiresAt.getTime() > 0 ? quote.quoteExpiresAt : quote.rateExpiresAt;
  return {
    id: quote.id,
    rate: quote.rate,
    fee: quote.wiseFee,
    sourceAmount: quote.source,
    targetAmount: quote.target,
    expiresAt,
    estimatedDelivery: quote.estimatedDelivery,
  };
}

function toPayoutTransfer(transfer: WiseTransfer): PayoutTransfer {
  return {
    id: transfer.id,
    status: mapWiseStatus(transfer.status),
    providerStatus: transfer.status,
    reference: transfer.reference,
  };
}

/** Exposed for callers that must not depend on Wise types to detect our errors. */
export function isPayoutError(error: unknown): error is PayoutError {
  return error instanceof PayoutError;
}
