import type { AuditLog } from '../../../application/audit/audit-log.ts';
import type {
  CreateQuoteInput,
  CreateRecipientBankAccountInput,
  CreateRecipientInput,
  CreateTransferInput,
  RequirementsRequest,
  WiseGateway,
} from './wise-gateway.ts';
import { WiseError, WiseScaRequiredError } from './wise-errors.ts';
import type {
  WiseCurrency,
  WiseDepositDetails,
  WiseProfile,
  WiseRequirementField,
  WiseRequirementGroup,
  WiseFundingResult,
  WiseFundingStatus,
  WiseMoney,
  WiseQuote,
  WiseRecipient,
  WiseTransfer,
  WiseTransferStatus,
} from './wise-models.ts';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../../../shared/money.ts';
import type { WiseHttpClient } from './wise-http-client.ts';
import type { WiseScaSigner } from './wise-sca-signer.ts';

/**
 * Minor-unit exponent for an ISO 4217 code (2 for GBP, 0 for JPY, 3 for KWD).
 * Must reject an unknown currency rather than guess: a wrong exponent turns
 * into an amount that is wrong by a factor of 10 or more.
 */
export type CurrencyMinorUnits = (currencyCode: string) => number | Promise<number>;

export interface WiseApiClientOptions {
  readonly http: WiseHttpClient;
  readonly profileId: string;
  readonly isSandbox: boolean;
  readonly auditLog: AuditLog;
  readonly scaSigner?: WiseScaSigner | undefined;
  readonly currencyMinorUnits: CurrencyMinorUnits;
  /**
   * The dated API version used in the path of the endpoints documented under
   * `/{version}/...` (e.g. `2026Q4`). The older `/v1`, `/v3` paths already used
   * for quotes and transfers stay as they are.
   */
  readonly apiVersion?: string | undefined;
}

const KNOWN_STATUSES: readonly WiseTransferStatus[] = [
  'incoming_payment_waiting',
  'incoming_payment_initiated',
  'processing',
  'funds_converted',
  'outgoing_payment_sent',
  'charged_back',
  'cancelled',
  'funds_refunded',
  'bounced_back',
];

/** The single implementation that speaks the real Wise Platform API. */
export class WiseApiClient implements WiseGateway {
  readonly #http: WiseHttpClient;
  readonly #profileId: string;
  readonly #isSandbox: boolean;
  readonly #auditLog: AuditLog;
  readonly #scaSigner: WiseScaSigner | undefined;
  readonly #minorUnits: CurrencyMinorUnits;
  readonly #version: string;

  constructor(options: WiseApiClientOptions) {
    this.#version = options.apiVersion ?? '2026Q4';
    this.#http = options.http;
    this.#profileId = options.profileId;
    this.#isSandbox = options.isSandbox;
    this.#auditLog = options.auditLog;
    this.#scaSigner = options.scaSigner;
    this.#minorUnits = options.currencyMinorUnits;
  }

  /** A path under the dated API version. */
  #v(path: string): string {
    return `/${this.#version}${path}`;
  }

  // --- Currencies and profiles ---------------------------------------------

  async listCurrencies(): Promise<WiseCurrency[]> {
    const { json } = await this.#http.send({ method: 'GET', path: this.#v('/currencies') });
    if (!Array.isArray(json)) {
      throw new WiseError('wise_unexpected', 'Wise currency list was not in the expected shape');
    }
    return (json as { code?: unknown; name?: unknown; supportsDecimals?: unknown }[])
      .filter((c) => typeof c.code === 'string' && /^[A-Z]{3}$/.test(c.code))
      .map((c) => ({
        code: c.code as string,
        name: typeof c.name === 'string' ? c.name : (c.code as string),
        supportsDecimals: c.supportsDecimals !== false,
      }));
  }

  async listProfiles(): Promise<WiseProfile[]> {
    const { json } = await this.#http.send({ method: 'GET', path: this.#v('/profiles') });
    if (!Array.isArray(json)) {
      throw new WiseError('wise_unexpected', 'Wise profile list was not in the expected shape');
    }
    return (json as { id?: unknown; type?: unknown; currentState?: unknown }[])
      .filter((p) => p.id !== undefined)
      .map((p) => ({
        id: asText(p.id),
        type: asText(p.type),
        currentState: asText(p.currentState),
      }));
  }

  // --- Recipient requirements ---------------------------------------------

  async getAccountRequirements(
    quoteId: string,
    request?: RequirementsRequest,
  ): Promise<WiseRequirementGroup[]> {
    const path = this.#v(`/quotes/${encodeURIComponent(quoteId)}/account-requirements`);
    // Wise asks new integrations to send this: the response then also carries the
    // recipient name and email fields some currencies need.
    const extraHeaders = { 'Accept-Minor-Version': '1' };
    const { json } = request
      ? await this.#http.send({
          method: 'POST',
          path,
          extraHeaders,
          body: {
            ...(request.type ? { type: request.type } : {}),
            profile: Number(this.#profileId),
            ownedByCustomer: false,
            ...(request.accountHolderName ? { accountHolderName: request.accountHolderName } : {}),
            details: request.details ?? {},
          },
          // Asking what is required changes nothing.
          retryable: true,
        })
      : await this.#http.send({ method: 'GET', path, extraHeaders });
    return parseRequirements(json);
  }

  async createRecipient(input: CreateRecipientInput): Promise<WiseRecipient> {
    const { json } = await this.#http.send({
      method: 'POST',
      path: this.#v('/accounts'),
      body: {
        currency: input.currency,
        type: input.type,
        profile: Number(this.#profileId),
        ownedByCustomer: false,
        accountHolderName: input.accountHolderName,
        details: input.details,
      },
    });
    return this.#toRecipient(json);
  }

  async updateQuote(quoteId: string, targetAccountId: string): Promise<WiseQuote> {
    const { json } = await this.#http.send({
      method: 'PATCH',
      path: this.#v(`/profiles/${this.#profileId}/quotes/${encodeURIComponent(quoteId)}`),
      extraHeaders: { 'content-type': 'application/merge-patch+json' },
      body: { targetAccount: Number(targetAccountId) },
      // Setting the recipient twice to the same value is harmless.
      retryable: true,
    });
    return this.#toQuote(json, undefined);
  }

  async getTransferRequirements(input: {
    quoteId: string;
    targetAccountId: string;
    details: Readonly<Record<string, unknown>>;
  }): Promise<WiseRequirementGroup[]> {
    const { json } = await this.#http.send({
      method: 'POST',
      path: this.#v('/transfer-requirements'),
      body: {
        targetAccount: Number(input.targetAccountId),
        quoteUuid: input.quoteId,
        // SomPay's customers are private individuals.
        originatorLegalEntityType: 'PRIVATE',
        details: input.details,
      },
      retryable: true,
    });
    return parseRequirements(json);
  }

  async getDepositDetails(transferId: string): Promise<WiseDepositDetails> {
    const { json } = await this.#http.send({
      method: 'GET',
      path: this.#v(
        `/profiles/${this.#profileId}/transfers/${encodeURIComponent(transferId)}/deposit-details/bank-transfer`,
      ),
    });
    const d = json as {
      payinBank?: { bankName?: unknown };
      payinBankAccount?: { details?: unknown };
      wiseInformation?: { localCompanyName?: unknown };
    };
    const items = (Array.isArray(d.payinBankAccount?.details) ? d.payinBankAccount.details : [])
      .map(
        (item: {
          label?: unknown;
          value?: unknown;
          title?: unknown;
          body?: unknown;
          key?: unknown;
        }) => ({
          label: asText(item.label) || asText(item.title) || asText(item.key),
          value: asText(item.value) || asText(item.body),
        }),
      )
      .filter((item) => item.label !== '' && item.value !== '');
    if (items.length === 0) {
      throw new WiseError('wise_unexpected', 'Wise returned no bank details to pay into');
    }
    return {
      bankName: asText(d.payinBank?.bankName) || undefined,
      accountHolder: asText(d.wiseInformation?.localCompanyName) || undefined,
      items,
    };
  }

  // --- Quotes ----------------------------------------------------------

  async createQuote(input: CreateQuoteInput): Promise<WiseQuote> {
    const body: Record<string, unknown> = {
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      ...(input.sourceAmountMinor !== undefined
        ? {
            sourceAmount: await this.#toDecimalNumber(
              input.sourceAmountMinor,
              input.sourceCurrency,
            ),
          }
        : {}),
      ...(input.targetAmountMinor !== undefined
        ? {
            targetAmount: await this.#toDecimalNumber(
              input.targetAmountMinor,
              input.targetCurrency,
            ),
          }
        : {}),
      ...(input.payOut ? { payOut: input.payOut } : {}),
      ...(input.targetAccountId ? { targetAccount: Number(input.targetAccountId) } : {}),
    };

    const { json } = await this.#http.send({
      method: 'POST',
      path: `/v3/profiles/${this.#profileId}/quotes`,
      body,
      retryable: true, // creating a quote has no side effect on money
    });
    return this.#toQuote(json, input.payOut);
  }

  // --- Recipients ----------------------------------------------------

  async createRecipientBankAccount(input: CreateRecipientBankAccountInput): Promise<WiseRecipient> {
    const details =
      input.iban !== undefined
        ? { legalType: input.legalType, IBAN: input.iban }
        : {
            legalType: input.legalType,
            sortCode: input.sortCode,
            accountNumber: input.accountNumber,
          };
    const type = input.iban !== undefined ? 'iban' : 'sort_code';

    const { json } = await this.#http.send({
      method: 'POST',
      path: '/v1/accounts',
      body: {
        currency: input.currency,
        type,
        profile: Number(this.#profileId),
        ownedByCustomer: false,
        accountHolderName: input.accountHolderName,
        details,
      },
    });
    return this.#toRecipient(json);
  }

  // --- Transfers ---------------------------------------------------

  async createTransfer(input: CreateTransferInput): Promise<WiseTransfer> {
    const { json } = await this.#http.send({
      method: 'POST',
      path: '/v1/transfers',
      body: {
        targetAccount: Number(input.targetAccountId),
        quoteUuid: input.quoteId,
        customerTransactionId: input.idempotencyKey,
        details: { ...(input.details ?? {}), reference: input.reference ?? '' },
      },
      // Safe to retry: Wise dedupes by customerTransactionId.
      retryable: true,
    });
    const transfer = await this.#toTransfer(json);
    await this.#auditLog.record({
      actorType: 'system',
      action: 'wise.transfer.created',
      entityType: 'wise_transfer',
      entityId: transfer.id,
      context: {
        idempotencyKey: input.idempotencyKey,
        quoteId: input.quoteId,
        status: transfer.status,
        source: moneyForAudit(transfer.source),
        target: moneyForAudit(transfer.target),
      },
    });
    return transfer;
  }

  async getTransfer(transferId: string): Promise<WiseTransfer> {
    const { json } = await this.#http.send({
      method: 'GET',
      path: `/v1/transfers/${encodeURIComponent(transferId)}`,
    });
    return this.#toTransfer(json);
  }

  async cancelTransfer(transferId: string): Promise<WiseTransfer> {
    const { json } = await this.#http.send({
      method: 'PUT',
      path: `/v1/transfers/${encodeURIComponent(transferId)}/cancel`,
    });
    const transfer = await this.#toTransfer(json);
    await this.#auditLog.record({
      actorType: 'system',
      action: 'wise.transfer.cancelled',
      entityType: 'wise_transfer',
      entityId: transfer.id,
      context: { status: transfer.status },
    });
    return transfer;
  }

  async fundTransferFromBalance(transferId: string): Promise<WiseFundingResult> {
    const path = `/v3/profiles/${this.#profileId}/transfers/${encodeURIComponent(transferId)}/payments`;
    const body = { type: 'BALANCE' };

    let json: unknown;
    try {
      ({ json } = await this.#http.send({ method: 'POST', path, body }));
    } catch (error) {
      if (error instanceof WiseScaRequiredError) {
        json = await this.#fundWithSca(path, body, error);
      } else {
        throw error;
      }
    }

    const result = this.#toFundingResult(transferId, json);
    await this.#auditLog.record({
      actorType: 'system',
      action: 'wise.transfer.funded',
      entityType: 'wise_transfer',
      entityId: transferId,
      context: { status: result.status, errorCode: result.errorCode ?? null },
    });
    return result;
  }

  async simulateTransferTransition(transferId: string, toStatus: string): Promise<WiseTransfer> {
    if (!this.#isSandbox) {
      throw new WiseError('wise_forbidden', 'Transfer simulation is only available in the sandbox');
    }
    const { json } = await this.#http.send({
      method: 'GET',
      path: `/v1/simulation/transfers/${encodeURIComponent(transferId)}/${encodeURIComponent(toStatus)}`,
      retryable: false,
    });
    return this.#toTransfer(json);
  }

  // --- SCA -------------------------------------------------------

  async #fundWithSca(path: string, body: unknown, sca: WiseScaRequiredError): Promise<unknown> {
    if (!this.#scaSigner) {
      throw new WiseError(
        'wise_sca_required',
        'Wise requires strong customer authentication but no signing key is configured',
        { httpStatus: 403 },
      );
    }
    const signature = this.#scaSigner.sign(sca.oneTimeToken);
    const { json } = await this.#http.send({
      method: 'POST',
      path,
      body,
      extraHeaders: {
        'x-2fa-approval': sca.oneTimeToken,
        'X-Signature': signature,
      },
    });
    return json;
  }

  // --- Mapping --------------------------------------------------

  /**
   * The Wise API takes amounts as JSON numbers. The conversion is exact for
   * any amount a double can represent; anything larger is refused, not rounded.
   */
  async #toDecimalNumber(minor: bigint, currency: string): Promise<number> {
    const magnitude = minor < 0n ? -minor : minor;
    if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new WiseError('wise_validation', 'Amount is too large to send to Wise exactly');
    }
    return Number(formatMinorUnits(minor, await this.#minorUnits(currency)));
  }

  async #money(amount: unknown, currency: unknown): Promise<WiseMoney> {
    if (
      (typeof amount !== 'number' && typeof amount !== 'string') ||
      typeof currency !== 'string'
    ) {
      throw new WiseError('wise_unexpected', 'Wise returned an unreadable money value');
    }
    return {
      currency,
      amountMinor: parseDecimalToMinorUnits(String(amount), await this.#minorUnits(currency)),
    };
  }

  async #toQuote(json: unknown, requestedPayOut: string | undefined): Promise<WiseQuote> {
    const q = json as {
      id?: unknown;
      sourceCurrency?: unknown;
      targetCurrency?: unknown;
      rate?: unknown;
      rateType?: unknown;
      payOut?: unknown;
      status?: unknown;
      rateExpirationTime?: unknown;
      expirationTime?: unknown;
      paymentOptions?: {
        payOut?: unknown;
        payInProduct?: unknown;
        sourceAmount?: unknown;
        targetAmount?: unknown;
        disabled?: unknown;
        estimatedDelivery?: unknown;
        fee?: { total?: unknown };
      }[];
    };
    const rate = asText(q.rate);
    if (typeof q.id !== 'string' || rate === '') {
      throw new WiseError('wise_unexpected', 'Wise quote response was not in the expected shape');
    }

    const payOut = typeof requestedPayOut === 'string' ? requestedPayOut : asText(q.payOut);
    const options = q.paymentOptions ?? [];
    const option =
      options.find((o) => o.disabled !== true && (payOut === '' || o.payOut === payOut)) ??
      options.find((o) => o.disabled !== true) ??
      options[0];
    if (!option) {
      throw new WiseError('wise_validation', 'Wise quote has no usable payment option');
    }

    return {
      id: q.id,
      source: await this.#money(option.sourceAmount, q.sourceCurrency),
      target: await this.#money(option.targetAmount, q.targetCurrency),
      rate,
      rateType: asText(q.rateType, 'FIXED'),
      wiseFee: await this.#money(option.fee?.total ?? 0, q.sourceCurrency),
      payOut: asText(option.payOut) || payOut,
      payInProduct: asText(option.payInProduct) || undefined,
      rateExpiresAt: toDate(q.rateExpirationTime) ?? new Date(0),
      quoteExpiresAt: toDate(q.expirationTime) ?? new Date(0),
      status: asText(q.status, 'PENDING'),
      estimatedDelivery: toDate(option.estimatedDelivery),
    };
  }

  #toRecipient(json: unknown): WiseRecipient {
    const r = json as {
      id?: unknown;
      currency?: unknown;
      type?: unknown;
      accountHolderName?: unknown;
      country?: unknown;
      active?: unknown;
      details?: Record<string, unknown> & { address?: { country?: unknown } };
      commonFieldMap?: { accountNumberField?: unknown };
    };
    const id = asText(r.id);
    if (id === '' || typeof r.currency !== 'string') {
      throw new WiseError(
        'wise_unexpected',
        'Wise recipient response was not in the expected shape',
      );
    }
    return {
      id,
      currency: r.currency,
      type: typeof r.type === 'string' ? r.type : 'unknown',
      accountHolderName: typeof r.accountHolderName === 'string' ? r.accountHolderName : '',
      country:
        typeof r.country === 'string'
          ? r.country
          : typeof r.details?.address?.country === 'string'
            ? r.details.address.country
            : undefined,
      active: r.active !== false,
      accountTail: accountTail(r.details, r.commonFieldMap?.accountNumberField),
    };
  }

  async #toTransfer(json: unknown): Promise<WiseTransfer> {
    const t = json as {
      id?: unknown;
      status?: unknown;
      customerTransactionId?: unknown;
      quoteUuid?: unknown;
      targetAccount?: unknown;
      reference?: unknown;
      rate?: unknown;
      sourceCurrency?: unknown;
      sourceValue?: unknown;
      targetCurrency?: unknown;
      targetValue?: unknown;
      created?: unknown;
      hasActiveIssues?: unknown;
      details?: { reference?: unknown };
    };
    const id = asText(t.id);
    if (id === '') {
      throw new WiseError(
        'wise_unexpected',
        'Wise transfer response was not in the expected shape',
      );
    }
    return {
      id,
      status: normaliseStatus(t.status),
      customerTransactionId:
        typeof t.customerTransactionId === 'string' ? t.customerTransactionId : '',
      quoteId: typeof t.quoteUuid === 'string' ? t.quoteUuid : undefined,
      targetAccountId:
        t.targetAccount === undefined ? undefined : asText(t.targetAccount) || undefined,
      reference:
        typeof t.details?.reference === 'string'
          ? t.details.reference
          : typeof t.reference === 'string'
            ? t.reference
            : undefined,
      rate: asText(t.rate) || undefined,
      source:
        t.sourceValue === undefined
          ? undefined
          : await this.#money(t.sourceValue, t.sourceCurrency),
      target:
        t.targetValue === undefined
          ? undefined
          : await this.#money(t.targetValue, t.targetCurrency),
      createdAt: toDate(t.created),
      hasActiveIssues: t.hasActiveIssues === true,
    };
  }

  #toFundingResult(transferId: string, json: unknown): WiseFundingResult {
    const f = json as { status?: unknown; errorCode?: unknown };
    const status: WiseFundingStatus = f.status === 'COMPLETED' ? 'COMPLETED' : 'REJECTED';
    return {
      transferId,
      status,
      errorCode: typeof f.errorCode === 'string' ? f.errorCode : undefined,
    };
  }
}

/**
 * The last four characters of the recipient's account identifier. Wise names
 * the field in `commonFieldMap.accountNumberField`; otherwise the usual keys are
 * tried. Only the tail is kept, never the full number.
 */
function accountTail(
  details: Record<string, unknown> | undefined,
  accountNumberField: unknown,
): string | undefined {
  if (!details) {
    return undefined;
  }
  const keys = [
    typeof accountNumberField === 'string' ? accountNumberField : '',
    'IBAN',
    'iban',
    'accountNumber',
    'clabe',
  ];
  for (const key of keys) {
    const value = key === '' ? undefined : details[key];
    if (typeof value === 'string' && value.length >= 4) {
      return value.slice(-4);
    }
  }
  return undefined;
}

/**
 * Reads Wise's dynamic-form response: an array of `{ type, title, fields }`
 * where each entry of `fields` is a titled section holding a `group` of field
 * definitions. Anything unreadable is skipped rather than guessed.
 */
export function parseRequirements(json: unknown): WiseRequirementGroup[] {
  if (!Array.isArray(json)) {
    throw new WiseError('wise_unexpected', 'Wise requirements were not in the expected shape');
  }
  return (json as { type?: unknown; title?: unknown; fields?: unknown }[]).map((entry) => ({
    type: asText(entry.type),
    title: asText(entry.title) || asText(entry.type),
    sections: (Array.isArray(entry.fields) ? entry.fields : []).map(
      (section: { name?: unknown; group?: unknown }) => ({
        name: asText(section.name),
        // Some responses list a field directly instead of a section holding fields.
        fields: (Array.isArray(section.group) ? section.group : [section])
          .map(toRequirementField)
          .filter((field): field is WiseRequirementField => field !== undefined),
      }),
    ),
  }));
}

function toRequirementField(raw: unknown): WiseRequirementField | undefined {
  const f = raw as {
    key?: unknown;
    name?: unknown;
    type?: unknown;
    required?: unknown;
    refreshRequirementsOnChange?: unknown;
    example?: unknown;
    minLength?: unknown;
    maxLength?: unknown;
    validationRegexp?: unknown;
    valuesAllowed?: unknown;
  };
  if (typeof f.key !== 'string' || f.key === '') {
    return undefined;
  }
  const options = Array.isArray(f.valuesAllowed)
    ? (f.valuesAllowed as { key?: unknown; name?: unknown }[])
        .filter((v) => v.key !== undefined && v.key !== null)
        .map((v) => ({ key: asText(v.key), name: asText(v.name) || asText(v.key) }))
    : undefined;
  return {
    key: f.key,
    name: asText(f.name) || f.key,
    type: asText(f.type, 'text'),
    required: f.required === true,
    refreshRequirementsOnChange: f.refreshRequirementsOnChange === true,
    example: asText(f.example) || undefined,
    minLength: typeof f.minLength === 'number' ? f.minLength : undefined,
    maxLength: typeof f.maxLength === 'number' ? f.maxLength : undefined,
    validationRegexp: typeof f.validationRegexp === 'string' ? f.validationRegexp : undefined,
    valuesAllowed: options && options.length > 0 ? options : undefined,
  };
}

/** Safe coercion of an unknown JSON scalar to a string (objects → fallback). */
function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return fallback;
}

function normaliseStatus(value: unknown): WiseTransferStatus {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as WiseTransferStatus)
    : 'unknown';
}

function toDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function moneyForAudit(money: WiseMoney | undefined): Record<string, string> | null {
  return money ? { currency: money.currency, amountMinor: money.amountMinor.toString() } : null;
}
