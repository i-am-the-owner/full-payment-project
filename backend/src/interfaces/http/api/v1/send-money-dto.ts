import type {
  Money,
  Recipient,
  Transfer,
  TransferQuote,
} from '../../../../domain/transfer/models.ts';
import { PROVIDER_DISPLAY_NAMES } from '../../../../domain/payout/models.ts';
import type { CurrencyRegistry } from '../../../../application/transfer/ports.ts';
import { formatMinorUnits } from '../../../../shared/money.ts';

export interface MoneyDto {
  currency: string;
  amount: string;
  amountMinor: string;
}

/**
 * Normalises a stored decimal rate for display: the DB NUMERIC column pads to a
 * fixed scale (`174.500000000000`), which is exact but noisy. Trailing zeros are
 * not semantically meaningful, so trim them – without touching precision.
 */
function formatRate(rate: string): string {
  if (!rate.includes('.')) {
    return rate;
  }
  return rate.replace(/\.?0+$/, '');
}

/** Formats domain money for the client. Amounts are strings – never JS numbers. */
export class SendMoneyDtoFactory {
  readonly #currencies: CurrencyRegistry;
  readonly #exponents = new Map<string, number>();

  constructor(currencies: CurrencyRegistry) {
    this.#currencies = currencies;
  }

  async money(value: Money): Promise<MoneyDto> {
    let exponent = this.#exponents.get(value.currency);
    if (exponent === undefined) {
      exponent = await this.#currencies.minorUnitExponent(value.currency);
      this.#exponents.set(value.currency, exponent);
    }
    return {
      currency: value.currency,
      amount: formatMinorUnits(value.amountMinor, exponent),
      amountMinor: value.amountMinor.toString(),
    };
  }

  async quote(q: TransferQuote): Promise<Record<string, unknown>> {
    return {
      id: q.id,
      source: await this.money(q.source),
      fee: await this.money(q.fee),
      totalToPay: await this.money(q.totalToPay),
      target: await this.money(q.target),
      exchangeRate: formatRate(q.exchangeRate),
      estimatedDelivery: q.estimatedDelivery?.toISOString() ?? null,
      expiresAt: q.expiresAt.toISOString(),
    };
  }

  /** A summary only: SomPay does not hold the recipient's bank details. */
  recipient(r: Recipient): Record<string, unknown> {
    return {
      id: r.id,
      displayName: r.displayName,
      accountHolderName: r.accountHolderName,
      country: r.countryCode,
      currency: r.currencyCode,
      accountSummary: r.accountSummary,
      isActive: r.isActive,
    };
  }

  async transfer(t: Transfer): Promise<Record<string, unknown>> {
    return {
      id: t.id,
      reference: t.reference,
      status: t.status,
      source: await this.money(t.source),
      fee: await this.money(t.fee),
      totalToPay: await this.money(t.totalToPay),
      target: await this.money(t.target),
      exchangeRate: formatRate(t.exchangeRate),
      recipientId: t.recipientId,
      recipientReference: t.recipientReference ?? null,
      provider: t.provider
        ? { name: t.provider, displayName: PROVIDER_DISPLAY_NAMES[t.provider] }
        : null,
      fundingMethod: t.fundingMethod ?? null,
      failureReason: t.failureReason ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
