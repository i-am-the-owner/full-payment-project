import { AppError, ValidationError } from '../../shared/errors.ts';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../../shared/money.ts';
import type { Money } from '../../domain/payout/models.ts';
import type { CurrencyCatalogue } from '../payout/currency-catalogue.ts';
import type { TransferRepository } from './ports.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export type TransferLimitKind = 'PER_TRANSFER' | 'PER_DAY' | 'PER_MONTH';

/** Limits from configuration, as decimal strings in `currency`. Never floats. */
export interface TransferLimitsConfig {
  readonly currency: string;
  readonly perTransfer: string;
  readonly perDay: string;
  readonly perMonth: string;
}

const MESSAGES: Record<TransferLimitKind, (amount: string) => string> = {
  PER_TRANSFER: (amount) => `You can send up to ${amount} in one transfer.`,
  PER_DAY: (amount) =>
    `This would take you over the limit of ${amount} in 24 hours. Try a smaller amount, or try again tomorrow.`,
  PER_MONTH: (amount) =>
    `This would take you over the limit of ${amount} in 30 days. Try a smaller amount.`,
};

/** The transfer would break one of the customer's sending limits. */
export class LimitExceededError extends AppError {
  readonly limit: TransferLimitKind;
  constructor(limit: TransferLimitKind, formattedLimit: string) {
    super('LIMIT_EXCEEDED', 422, MESSAGES[limit](formattedLimit), [
      { field: 'limit', message: limit },
    ]);
    this.limit = limit;
  }
}

export interface TransferLimits {
  /**
   * Throws {@link LimitExceededError} if paying `amount` now would break a
   * limit. `amount` is everything the customer pays (fee included).
   */
  check(userId: string, amount: Money): Promise<void>;
}

/**
 * Per-customer sending limits: one transfer, a rolling 24 hours and a rolling
 * 30 days. Transfers that were cancelled, failed or refunded do not count.
 */
export function createTransferLimits(deps: {
  config: TransferLimitsConfig;
  currencyCatalogue: Pick<CurrencyCatalogue, 'minorUnitExponent'>;
  transferRepository: Pick<TransferRepository, 'totalPaidSince'>;
  clock: () => Date;
}): TransferLimits {
  return {
    async check(userId, amount) {
      const { config } = deps;
      if (amount.currency !== config.currency) {
        // No limit is configured for this currency, so nothing may be sent in it.
        throw new ValidationError(`Transfers paid in ${amount.currency} are not available yet.`);
      }
      const exponent = await deps.currencyCatalogue.minorUnitExponent(config.currency);
      const minor = (decimal: string): bigint => parseDecimalToMinorUnits(decimal, exponent);
      const show = (value: bigint): string =>
        `${formatMinorUnits(value, exponent)} ${config.currency}`;

      const perTransfer = minor(config.perTransfer);
      if (amount.amountMinor > perTransfer) {
        throw new LimitExceededError('PER_TRANSFER', show(perTransfer));
      }

      const now = deps.clock().getTime();
      for (const [kind, limit, windowMs] of [
        ['PER_DAY', minor(config.perDay), DAY_MS],
        ['PER_MONTH', minor(config.perMonth), MONTH_MS],
      ] as const) {
        const already = await deps.transferRepository.totalPaidSince(
          userId,
          config.currency,
          new Date(now - windowMs),
        );
        if (already + amount.amountMinor > limit) {
          throw new LimitExceededError(kind, show(limit));
        }
      }
    },
  };
}
