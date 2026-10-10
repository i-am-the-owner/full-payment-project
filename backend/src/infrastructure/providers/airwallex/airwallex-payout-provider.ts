import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CreateQuoteParams,
  CreateRecipientParams,
  CreateTransferParams,
  PayoutProvider,
  RecipientFormParams,
} from '../../../application/payout/payout-provider.ts';
import {
  DuplicateError,
  NotSupportedError,
  ProviderRejectedError,
  ProviderUnavailableError,
  ValidationFailedError,
} from '../../../domain/payout/errors.ts';
import type {
  BankDetail,
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
import { formatMinorUnits, parseDecimalToMinorUnits } from '../../../shared/money.ts';
import { currencyDisplayName, iso4217MinorUnits } from '../iso-4217.ts';
import type { ProviderHttpClient, ProviderHttpRequest } from '../provider-http-client.ts';
import type { AirwallexConfig } from './airwallex-config.ts';
import { currenciesFromSchema, nestValues, toDynamicForm } from './airwallex-forms.ts';
import { mapAirwallexAccountStatus, mapAirwallexStatus } from './airwallex-status-mapping.ts';

const NAME = 'airwallex';
const CURRENCY_CACHE_MS = 24 * 60 * 60 * 1000;
// A webhook older (or newer) than this is refused, to limit replay.
const WEBHOOK_TOLERANCE_MS = 10 * 60 * 1000;

/** Accepted `reason` values. Source: Airwallex docs, "Create a transfer". */
const TRANSFER_REASONS = [
  'audio_visual_services',
  'bill_payment',
  'business_expenses',
  'construction',
  'donation_charitable_contribution',
  'education_training',
  'freight',
  'goods_purchased',
  'investment_capital',
  'investment_proceeds',
  'living_expenses',
  'loan_credit_repayment',
  'medical_services',
  'pension',
  'professional_business_services',
  'real_estate',
  'taxes',
  'technical_services',
  'transfer_to_own_account',
  'travel',
  'wages_salary',
  'other_services',
] as const;

const HOSTED_FLOW_INDIVIDUALS =
  'startCustomerOnboarding for INDIVIDUAL accounts (Airwallex documents its hosted onboarding ' +
  'flow as business accounts only; individuals need the embedded component or the native API)';

interface AirwallexTransfer {
  id?: unknown;
  status?: unknown;
  source_currency?: unknown;
  amount_payer_pays?: unknown;
  funding?: { status?: unknown };
}

export interface AirwallexPayoutProviderDeps {
  readonly config: AirwallexConfig;
  readonly http: ProviderHttpClient;
  readonly clock?: () => Date;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function tail(value: string): string {
  return value.length >= 4 ? `••••${value.slice(-4)}` : '••••';
}

function humanise(code: string): string {
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Exact decimal division `1 / rate`, to 12 places, without floating point. */
function invertRate(rate: string): string {
  const [whole = '0', fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const value = BigInt(`${whole}${fraction}`);
  if (value <= 0n) {
    throw new ProviderUnavailableError('Airwallex returned an unusable rate.');
  }
  const precision = 10n ** 12n;
  const inverted = (scale * precision) / value;
  const digits = inverted.toString().padStart(13, '0');
  const text = `${digits.slice(0, -12)}.${digits.slice(-12)}`.replace(/\.?0+$/, '');
  return text === '' ? '0' : text;
}

/**
 * Airwallex (Connected Accounts) behind the provider-neutral interface.
 *
 * Each SomPay customer has their own Airwallex connected account; Airwallex
 * verifies them and holds their funds in their own Wallet. Every customer call
 * is made on behalf of that account with the `x-on-behalf-of` header.
 *
 * Written from the Airwallex documentation (API version 2026-08-21). It has
 * unit tests against documented response shapes but has NOT been run against
 * the Airwallex sandbox: no credentials were available.
 */
export class AirwallexPayoutProvider implements PayoutProvider {
  readonly name = NAME;
  readonly #config: AirwallexConfig;
  readonly #http: ProviderHttpClient;
  readonly #clock: () => Date;
  #currencies: { list: Currency[]; fetchedAt: number } | undefined;

  constructor(deps: AirwallexPayoutProviderDeps) {
    this.#config = deps.config;
    this.#http = deps.http;
    this.#clock = deps.clock ?? (() => new Date());
  }

  async getCapabilities(): Promise<Capabilities> {
    const currencies = await this.listCurrencies();
    return {
      provider: NAME,
      sourceCurrencies: this.#config.sourceCurrencies,
      targetCurrencies: currencies.map((currency) => currency.code),
      features: {
        needsCustomerRedirectForKyc: true,
        // A transfer is paid from the customer's own Airwallex Wallet, which
        // they top up by bank transfer to their own global account.
        fundingMethods: ['BANK_TRANSFER', 'BALANCE'],
      },
      senderCountries: [this.#config.accountCountry],
      unsupportedOperations:
        this.#config.legalEntityType === 'INDIVIDUAL' ? [HOSTED_FLOW_INDIVIDUALS] : [],
    };
  }

  // --- Customers: connected accounts ---------------------------------------

  /**
   * Finds or creates the customer's connected account, then opens Airwallex's
   * hosted onboarding flow for it. The account carries our user id as its
   * `identifier`, which is how it is found again – never via client input.
   *
   * Creating an account asserts that the customer agreed to Airwallex's terms
   * and data usage. The app must have collected that agreement before this is
   * called.
   */
  async startCustomerOnboarding(
    user: OnboardingUser,
    context: OnboardingContext,
  ): Promise<OnboardingStart> {
    const account = (await this.#findAccount(user)) ?? (await this.#createAccount(user));
    if (account.status === 'ACTIVE') {
      return { kind: 'done' };
    }
    if (this.#config.legalEntityType === 'INDIVIDUAL') {
      throw new NotSupportedError(
        NAME,
        'hosted onboarding for individual accounts',
        'Airwallex documents the hosted flow as business accounts only',
      );
    }
    if (!this.#config.hostedFlowTemplateId) {
      throw new NotSupportedError(
        NAME,
        'hosted onboarding',
        'AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID is not set (Airwallex provides the template id)',
      );
    }

    const flow = (await this.#send({
      method: 'POST',
      path: '/api/v1/hosted_flows/create',
      body: {
        account_id: account.id,
        template: this.#config.hostedFlowTemplateId,
        // Our callback (which carries the CSRF state) unless one is configured.
        return_url: this.#config.onboardingReturnUrl ?? context.returnUrl,
        ...(this.#config.onboardingErrorUrl ? { error_url: this.#config.onboardingErrorUrl } : {}),
      },
    })) as { id?: unknown };
    const flowId = str(flow.id);
    if (!flowId) {
      throw new ProviderUnavailableError('Airwallex returned no hosted flow id.');
    }

    // The URL must be authorised for this user before it is handed over; it is
    // short-lived, so the caller should redirect straight away.
    const authorised = (await this.#send({
      method: 'POST',
      path: `/api/v1/hosted_flows/${encodeURIComponent(flowId)}/authorize`,
      body: { identity: user.id },
    })) as { url?: unknown };
    const url = str(authorised.url);
    if (!url) {
      throw new ProviderUnavailableError('Airwallex returned no hosted flow URL.');
    }
    return { kind: 'redirect', url, link: { provider: NAME, customerRef: account.id } };
  }

  /**
   * Links the customer to their connected account. The account is looked up at
   * Airwallex by our own user id; `callbackParams` come from the browser and
   * are deliberately not trusted for this.
   */
  async completeCustomerOnboarding(user: OnboardingUser): Promise<CompletedOnboarding> {
    const account = await this.#findAccount(user);
    if (!account) {
      throw new ProviderRejectedError('No Airwallex account exists for this customer yet.');
    }
    return { link: { provider: NAME, customerRef: account.id } };
  }

  async getCustomerStatus(link: ProviderCustomerLink): Promise<CustomerStatus> {
    const account = (await this.#send({
      method: 'GET',
      path: `/api/v1/accounts/${encodeURIComponent(link.customerRef)}`,
    })) as { status?: unknown };
    return mapAirwallexAccountStatus(str(account.status) ?? '');
  }

  // --- Pricing -------------------------------------------------------------

  /**
   * Airwallex has no "list currencies" endpoint. The beneficiary form schema,
   * called with no conditions, returns every accepted `account_currency`.
   * Minor units are the ISO 4217 standard. Cached for 24 hours.
   */
  async listCurrencies(): Promise<Currency[]> {
    const now = this.#clock().getTime();
    if (this.#currencies && now - this.#currencies.fetchedAt < CURRENCY_CACHE_MS) {
      return this.#currencies.list;
    }
    const schema = await this.#send({
      method: 'POST',
      path: '/api/v1/beneficiary_form_schemas/generate',
      body: {},
      retryable: true,
    });
    const list = currenciesFromSchema(schema).map((code) => ({
      code,
      name: currencyDisplayName(code),
      minorUnit: iso4217MinorUnits(code),
    }));
    if (list.length === 0) {
      throw new ProviderUnavailableError('Airwallex returned no supported currencies.');
    }
    this.#currencies = { list, fetchedAt: now };
    return list;
  }

  /**
   * A guaranteed FX rate (`POST /api/v1/fx/quotes/create`), valid 30 minutes.
   * An Airwallex quote carries no transfer fee: the fee is only known once the
   * transfer is created, so the quote's fee is zero.
   */
  async createQuote(params: CreateQuoteParams): Promise<PayoutQuote> {
    const hasSource = params.sourceAmountMinor !== undefined;
    if (hasSource === (params.targetAmountMinor !== undefined)) {
      throw new ValidationFailedError([
        { field: 'sourceAmount', message: 'Give either a source amount or a target amount' },
      ]);
    }
    const quote = (await this.#send(
      {
        method: 'POST',
        path: '/api/v1/fx/quotes/create',
        body: {
          sell_currency: params.sourceCurrency,
          buy_currency: params.targetCurrency,
          validity: 'MIN_30',
          ...(params.sourceAmountMinor !== undefined
            ? { sell_amount: this.#toNumber(params.sourceAmountMinor, params.sourceCurrency) }
            : {
                buy_amount: this.#toNumber(params.targetAmountMinor ?? 0n, params.targetCurrency),
              }),
        },
        retryable: true, // a quote moves no money
      },
      params.link,
    )) as {
      quote_id?: unknown;
      client_rate?: unknown;
      currency_pair?: unknown;
      sell_amount?: unknown;
      buy_amount?: unknown;
      valid_to_at?: unknown;
    };

    const id = str(quote.quote_id);
    const expiresAt = new Date(str(quote.valid_to_at) ?? '');
    const clientRate =
      typeof quote.client_rate === 'number' || typeof quote.client_rate === 'string'
        ? this.#decimalString(quote.client_rate)
        : undefined;
    if (!id || !clientRate || Number.isNaN(expiresAt.getTime())) {
      throw new ProviderUnavailableError('Airwallex returned a quote that could not be read.');
    }
    // `client_rate` follows the market convention of `currency_pair`, which may
    // be the reverse of source -> target.
    const direct = str(quote.currency_pair) === `${params.sourceCurrency}${params.targetCurrency}`;
    return {
      id,
      rate: direct ? clientRate : invertRate(clientRate),
      fee: { currency: params.sourceCurrency, amountMinor: 0n },
      sourceAmount: this.#money(quote.sell_amount, params.sourceCurrency),
      targetAmount: this.#money(quote.buy_amount, params.targetCurrency),
      expiresAt,
      estimatedDelivery: undefined,
    };
  }

  // --- Recipients: beneficiaries -------------------------------------------

  async getRecipientForm(params: RecipientFormParams): Promise<DynamicForm> {
    const partial = params.partialValues ?? {};
    const schema = await this.#send(
      {
        method: 'POST',
        path: '/api/v1/beneficiary_form_schemas/generate',
        body: {
          account_currency: params.currency,
          bank_country_code: params.country,
          entity_type: partial['beneficiary.entity_type'] ?? 'PERSONAL',
          transfer_method: partial.transfer_method ?? 'LOCAL',
          ...(partial['beneficiary.bank_details.local_clearing_system']
            ? {
                local_clearing_system: partial['beneficiary.bank_details.local_clearing_system'],
              }
            : {}),
        },
        retryable: true,
      },
      params.link,
    );
    return toDynamicForm(schema);
  }

  async createRecipient(params: CreateRecipientParams): Promise<PayoutRecipient> {
    const nested = nestValues(params.values) as {
      beneficiary?: Record<string, unknown> & { bank_details?: Record<string, unknown> };
      transfer_method?: unknown;
    };
    const beneficiary = nested.beneficiary ?? {};
    beneficiary.bank_details = {
      ...(beneficiary.bank_details ?? {}),
      account_currency: params.currency,
      bank_country_code: params.country,
    };

    const created = (await this.#send(
      {
        method: 'POST',
        path: '/api/v1/beneficiaries/create',
        body: {
          beneficiary,
          transfer_methods: [str(nested.transfer_method) ?? 'LOCAL'],
        },
      },
      params.link,
    )) as {
      id?: unknown;
      beneficiary?: {
        company_name?: unknown;
        first_name?: unknown;
        last_name?: unknown;
        bank_details?: { account_name?: unknown; account_number?: unknown; iban?: unknown };
      };
    };

    const id = str(created.id);
    if (!id) {
      throw new ProviderUnavailableError('Airwallex returned no beneficiary id.');
    }
    const details = created.beneficiary?.bank_details ?? {};
    const iban = str(details.iban);
    const accountNumber = str(details.account_number);
    const personal = [str(created.beneficiary?.first_name), str(created.beneficiary?.last_name)]
      .filter(Boolean)
      .join(' ');
    return {
      id,
      name: str(details.account_name) ?? str(created.beneficiary?.company_name) ?? personal,
      currency: params.currency,
      country: params.country,
      // A masked tail only: the full details stay with Airwallex.
      accountSummary: iban ? `IBAN ${tail(iban)}` : `Acct ${tail(accountNumber ?? '')}`,
    };
  }

  /** Airwallex quotes do not depend on the recipient: the quote is used as issued. */
  updateQuoteWithRecipient(params: { quote: PayoutQuote }): Promise<PayoutQuote> {
    return Promise.resolve(params.quote);
  }

  // --- Transfers -----------------------------------------------------------

  /** The transfer needs a `reason` and a transfer method, both from Airwallex's lists. */
  getTransferForm(): Promise<DynamicForm> {
    return Promise.resolve({
      groups: [{ key: 'transfer', label: 'About this transfer' }],
      fields: [
        {
          key: 'reason',
          label: 'Reason for the transfer',
          type: 'select',
          required: true,
          group: 'transfer',
          validation: {},
          options: TRANSFER_REASONS.map((value) => ({ value, label: humanise(value) })),
          refreshOnChange: false,
        },
        {
          key: 'transfer_method',
          label: 'Transfer method',
          type: 'select',
          required: true,
          group: 'transfer',
          validation: {},
          options: [
            { value: 'LOCAL', label: 'Local bank transfer' },
            { value: 'SWIFT', label: 'SWIFT' },
          ],
          refreshOnChange: false,
        },
      ],
    });
  }

  async findTransferByIdempotencyKey(params: {
    link: ProviderCustomerLink;
    idempotencyKey: string;
  }): Promise<PayoutTransfer | null> {
    const existing = await this.#findTransferByRequestId(params.link, params.idempotencyKey);
    return existing ? this.#toTransfer(existing, undefined) : null;
  }

  /**
   * Creates the transfer with our idempotency UUID as `request_id`. Airwallex
   * rejects a repeated `request_id` instead of returning the first transfer,
   * and says to look the transfer up by `request_id` when the outcome of a
   * create is uncertain – so both cases are resolved by that lookup.
   */
  async createTransfer(params: CreateTransferParams): Promise<PayoutTransfer> {
    const reason = params.answers.reason;
    if (!reason) {
      throw new ValidationFailedError([{ field: 'reason', message: 'Choose a reason' }]);
    }
    try {
      const created = await this.#send(
        {
          method: 'POST',
          path: '/api/v1/transfers/create',
          body: {
            request_id: params.idempotencyKey,
            beneficiary_id: params.recipient.id,
            quote_id: params.quote.id,
            source_currency: params.quote.sourceAmount.currency,
            transfer_currency: params.quote.targetAmount.currency,
            // Amounts are sent as decimal strings, as the API specifies.
            source_amount: formatMinorUnits(
              params.quote.sourceAmount.amountMinor,
              iso4217MinorUnits(params.quote.sourceAmount.currency),
            ),
            transfer_method: params.answers.transfer_method ?? 'LOCAL',
            reason,
            reference: params.reference,
          },
          // Never blindly resent: a retry goes through the lookup below.
          retryable: false,
        },
        params.link,
      );
      return this.#toTransfer(created as AirwallexTransfer, params.reference);
    } catch (error) {
      const uncertain = error instanceof ProviderUnavailableError && error.outcomeUnknown;
      if (!uncertain && !(error instanceof DuplicateError)) {
        throw error;
      }
      const existing = await this.#findTransferByRequestId(params.link, params.idempotencyKey);
      if (existing) {
        return this.#toTransfer(existing, params.reference);
      }
      // Not there (yet): report the original outcome so the caller keeps the
      // transfer pending and tries again later with the same key.
      throw error;
    }
  }

  /**
   * How the customer gets money into the Wallet that pays for the transfer:
   * a bank transfer to their own Airwallex global account in the source
   * currency, or the Wallet balance they already hold. Never SomPay's account.
   */
  async getFundingInstructions(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
  }): Promise<FundingInstructions[]> {
    const transfer = await this.#getTransfer(params.link, params.transfer.id);
    const currency = str(transfer.source_currency);
    if (!currency) {
      throw new ProviderUnavailableError(
        'Airwallex returned a transfer without a source currency.',
      );
    }
    const amount = this.#money(transfer.amount_payer_pays, currency);
    const instructions: FundingInstructions[] = [{ method: 'BALANCE', amount }];

    const accounts = (await this.#send(
      {
        method: 'GET',
        path: '/api/v1/global_accounts',
        query: { 'supported_features.currency': currency, status: 'ACTIVE' },
      },
      params.link,
    )) as { items?: Record<string, unknown>[] };
    const account = accounts.items?.[0];
    if (account) {
      const institution = (account.institution ?? {}) as { name?: unknown };
      const features = (account.supported_features ?? []) as {
        routing_codes?: { type?: unknown; value?: unknown }[];
      }[];
      const bankDetails: BankDetail[] = [
        ...(str(institution.name) ? [{ label: 'Bank', value: str(institution.name)! }] : []),
        ...(str(account.iban) ? [{ label: 'IBAN', value: str(account.iban)! }] : []),
        ...(str(account.account_number)
          ? [{ label: 'Account number', value: str(account.account_number)! }]
          : []),
        ...(features[0]?.routing_codes ?? [])
          .filter((code) => str(code.type) && str(code.value))
          .map((code) => ({ label: humanise(str(code.type)!), value: str(code.value)! })),
      ];
      // The customer pays into their own account, so no payment reference is needed.
      instructions.unshift({ method: 'BANK_TRANSFER', amount, bankDetails, reference: '' });
    }
    return instructions;
  }

  /**
   * Airwallex deducts a transfer from the customer's Wallet by itself when it
   * is created or on its transfer date; there is nothing to trigger. This
   * reports where that funding stands.
   */
  async fundTransfer(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
    method: FundingMethod;
  }): Promise<FundingResult> {
    const transfer = await this.#getTransfer(params.link, params.transfer.id);
    const funding = str(transfer.funding?.status);
    if (funding === 'FUNDED') return { status: 'COMPLETED', errorCode: undefined };
    if (funding === 'FAILED' || funding === 'CANCELLED' || funding === 'REVERSED') {
      return { status: 'REJECTED', errorCode: `funding.${funding.toLowerCase()}` };
    }
    return { status: 'PENDING', errorCode: undefined };
  }

  async getTransfer(params: {
    link: ProviderCustomerLink;
    transferRef: string;
  }): Promise<PayoutTransfer> {
    return this.#toTransfer(await this.#getTransfer(params.link, params.transferRef), undefined);
  }

  async cancelTransfer(params: {
    link: ProviderCustomerLink;
    transfer: PayoutTransfer;
  }): Promise<void> {
    await this.#send(
      {
        method: 'POST',
        path: `/api/v1/transfers/${encodeURIComponent(params.transfer.id)}/cancel`,
      },
      params.link,
    );
  }

  // --- Webhooks ------------------------------------------------------------

  /**
   * `x-signature` is the hex HMAC-SHA256, keyed with the notification URL's
   * secret, of `x-timestamp` followed by the raw body. Verified on the exact
   * bytes received, before any parsing. Without a configured secret, nothing
   * is accepted.
   */
  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): boolean {
    const secret = this.#config.webhookSecret;
    const timestamp = headers['x-timestamp'];
    const signature = headers['x-signature'];
    if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) {
      return false;
    }
    if (Math.abs(this.#clock().getTime() - Number(timestamp)) > WEBHOOK_TOLERANCE_MS) {
      return false;
    }
    const expected = createHmac('sha256', secret).update(timestamp).update(rawBody).digest();
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /**
   * Handles `payout.transfer.<status>` events. Funding events
   * (`payout.transfer.funding.*`) and every other event are reported as
   * unknown and ignored.
   *
   * Airwallex's payload contains the beneficiary's full bank details. `raw` is
   * rebuilt from a short allow-list so none of that is ever stored or logged.
   */
  parseWebhook(rawBody: Buffer): NormalisedEvent {
    let body: {
      id?: unknown;
      name?: unknown;
      account_id?: unknown;
      created_at?: unknown;
      data?: { id?: unknown; status?: unknown; request_id?: unknown };
      accountId?: unknown;
    };
    try {
      body = JSON.parse(rawBody.toString('utf8')) as typeof body;
    } catch {
      body = {};
    }
    const name = str(body.name) ?? '';
    const raw = {
      id: str(body.id),
      name,
      account_id: str(body.account_id),
      created_at: str(body.created_at),
      data: {
        id: str(body.data?.id),
        status: str(body.data?.status),
        request_id: str(body.data?.request_id),
      },
    };
    const accountEvent =
      /^account\.(active|submitted|action_required|suspended|dormant|closed)$/.exec(name);
    if (accountEvent) {
      const accountId = raw.account_id ?? str((body as { accountId?: unknown }).accountId);
      const at = new Date(raw.created_at ?? '');
      if (accountId) {
        return {
          type: 'customer.status_changed',
          providerTransferId: undefined,
          newStatus: null,
          providerStatus: accountEvent[1]!.toUpperCase(),
          eventId: raw.id,
          occurredAt: Number.isNaN(at.getTime()) ? this.#clock() : at,
          // The event's `data` is the whole account (personal details): not kept.
          raw: { id: raw.id, name, account_id: accountId, created_at: raw.created_at },
          providerCustomerRef: accountId,
          newCustomerStatus: mapAirwallexAccountStatus(accountEvent[1]!.toUpperCase()),
        };
      }
    }
    const occurredAt = new Date(raw.created_at ?? '');
    const isTransferStatus = /^payout\.transfer\.[a-z_]+$/.test(name);
    if (
      !isTransferStatus ||
      !raw.data.id ||
      !raw.data.status ||
      Number.isNaN(occurredAt.getTime())
    ) {
      return {
        type: 'unknown',
        providerTransferId: undefined,
        newStatus: null,
        providerStatus: undefined,
        eventId: raw.id,
        occurredAt: this.#clock(),
        raw,
      };
    }
    return {
      type: 'transfer.status_changed',
      providerTransferId: raw.data.id,
      newStatus: mapAirwallexStatus(raw.data.status),
      providerStatus: raw.data.status,
      eventId: raw.id,
      occurredAt,
      raw,
    };
  }

  // --- Sandbox only (not part of PayoutProvider) ---------------------------

  /**
   * Moves a sandbox transfer to its next status
   * (`POST /api/v1/simulation/transfers/{id}/transition`). Refused outside the
   * sandbox.
   */
  async simulateTransferTransition(
    link: ProviderCustomerLink,
    transferId: string,
    nextStatus: 'OVERDUE' | 'PROCESSING' | 'SENT' | 'PAID' | 'FAILED' | 'CANCELLED',
  ): Promise<void> {
    if (!this.#config.isSandbox) {
      throw new NotSupportedError(NAME, 'transfer simulation', 'it exists only in the sandbox');
    }
    await this.#send(
      {
        method: 'POST',
        path: `/api/v1/simulation/transfers/${encodeURIComponent(transferId)}/transition`,
        body: { next_status: nextStatus },
      },
      link,
    );
  }

  // --- Internals -----------------------------------------------------------

  /** Sends a request, on behalf of the customer's connected account when given. */
  async #send(request: ProviderHttpRequest, link?: ProviderCustomerLink): Promise<unknown> {
    const { json } = await this.#http.send({
      ...request,
      extraHeaders: {
        'x-api-version': this.#config.apiVersion,
        ...(link ? { 'x-on-behalf-of': link.customerRef } : {}),
        ...request.extraHeaders,
      },
    });
    return json ?? {};
  }

  async #findAccount(user: OnboardingUser): Promise<{ id: string; status: string } | undefined> {
    const found = (await this.#send({
      method: 'GET',
      path: '/api/v1/accounts',
      query: { identifier: user.id },
    })) as { items?: { id?: unknown; status?: unknown; identifier?: unknown }[] };
    const account = (found.items ?? []).find((item) => item.identifier === user.id);
    const id = str(account?.id);
    return id ? { id, status: str(account?.status) ?? '' } : undefined;
  }

  async #createAccount(user: OnboardingUser): Promise<{ id: string; status: string }> {
    const individual = this.#config.legalEntityType === 'INDIVIDUAL';
    const created = (await this.#send({
      method: 'POST',
      path: '/api/v1/accounts/create',
      body: {
        identifier: user.id,
        primary_contact: { email: user.email },
        account_details: individual
          ? {
              legal_entity_type: 'INDIVIDUAL',
              individual_details: {
                residential_address: { country_code: this.#config.accountCountry },
              },
            }
          : {
              legal_entity_type: 'BUSINESS',
              business_details: {
                registration_address: { country_code: this.#config.accountCountry },
              },
            },
        customer_agreements: { agreed_to_terms_and_conditions: true, agreed_to_data_usage: true },
      },
    })) as { id?: unknown; status?: unknown };
    const id = str(created.id);
    if (!id) {
      throw new ProviderUnavailableError('Airwallex returned no account id.');
    }
    return { id, status: str(created.status) ?? 'CREATED' };
  }

  async #getTransfer(link: ProviderCustomerLink, transferId: string): Promise<AirwallexTransfer> {
    return (await this.#send(
      { method: 'GET', path: `/api/v1/transfers/${encodeURIComponent(transferId)}` },
      link,
    )) as AirwallexTransfer;
  }

  async #findTransferByRequestId(
    link: ProviderCustomerLink,
    requestId: string,
  ): Promise<AirwallexTransfer | undefined> {
    const found = (await this.#send(
      { method: 'GET', path: '/api/v1/transfers', query: { request_id: requestId } },
      link,
    )) as { items?: (AirwallexTransfer & { request_id?: unknown })[] };
    return (found.items ?? []).find((item) => item.request_id === requestId);
  }

  #toTransfer(transfer: AirwallexTransfer, reference: string | undefined): PayoutTransfer {
    const id = str(transfer.id);
    const status = str(transfer.status);
    if (!id || !status) {
      throw new ProviderUnavailableError('Airwallex returned a transfer that could not be read.');
    }
    return { id, status: mapAirwallexStatus(status), providerStatus: status, reference };
  }

  #decimalString(value: number | string): string {
    return typeof value === 'string'
      ? value
      : value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
  }

  #money(amount: unknown, currency: string): Money {
    if (typeof amount !== 'number' && typeof amount !== 'string') {
      throw new ProviderUnavailableError('Airwallex returned an unreadable amount.');
    }
    return {
      currency,
      amountMinor: parseDecimalToMinorUnits(amount, iso4217MinorUnits(currency)),
    };
  }

  /** Airwallex takes quote amounts as JSON numbers; refuse what a double cannot hold exactly. */
  #toNumber(minor: bigint, currency: string): number {
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ValidationFailedError([{ field: 'amount', message: 'The amount is too large' }]);
    }
    return Number(formatMinorUnits(minor, iso4217MinorUnits(currency)));
  }
}
