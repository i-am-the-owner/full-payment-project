import { ValidationError } from '../../shared/errors.ts';
import { RouteNotSupportedError } from '../../domain/payout/errors.ts';
import type { TransferQuote } from '../../domain/transfer/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { CurrencyCatalogue } from '../payout/currency-catalogue.ts';
import { requireVerifiedLink } from '../payout/customer-onboarding.ts';
import type { TransferPause } from '../settings/transfer-pause.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import type { CustomerLinkStore, QuoteRepository } from './ports.ts';

export interface RequestQuoteInput {
  readonly userId: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  /** Exactly one of the two amounts, in minor units. */
  readonly sourceAmountMinor?: bigint | undefined;
  readonly targetAmountMinor?: bigint | undefined;
}

export type RequestQuote = (input: RequestQuoteInput) => Promise<TransferQuote>;

export interface RequestQuoteDeps {
  readonly provider: PayoutProvider;
  readonly currencyCatalogue: CurrencyCatalogue;
  readonly customerLinkStore: CustomerLinkStore;
  readonly quoteRepository: QuoteRepository;
  readonly auditLog: AuditLog;
  /** When set, a quote cannot be started while new transfers are paused. */
  readonly transferPause?: Pick<TransferPause, 'assertNewTransfersAllowed'> | undefined;
  readonly clock: () => Date;
}

/**
 * Prices a transfer. Every figure – rate, fee, amounts, expiry – comes from the
 * provider and is stored immutably; a client receives it and displays it, and
 * never recalculates anything.
 */
export function createRequestQuote(deps: RequestQuoteDeps): RequestQuote {
  return async (input) => {
    const hasSource = input.sourceAmountMinor !== undefined;
    const hasTarget = input.targetAmountMinor !== undefined;
    if (hasSource === hasTarget) {
      throw new ValidationError('Give either the amount to send or the amount to receive.');
    }

    await deps.transferPause?.assertNewTransfersAllowed();
    const link = await requireVerifiedLink(deps, input.userId);

    const { capabilities } = await deps.currencyCatalogue.get();
    if (
      !capabilities.sourceCurrencies.includes(input.sourceCurrency) ||
      !capabilities.targetCurrencies.includes(input.targetCurrency)
    ) {
      throw new RouteNotSupportedError();
    }

    const providerQuote = await deps.provider.createQuote({
      link,
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      ...(input.sourceAmountMinor !== undefined
        ? { sourceAmountMinor: input.sourceAmountMinor }
        : {}),
      ...(input.targetAmountMinor !== undefined
        ? { targetAmountMinor: input.targetAmountMinor }
        : {}),
    });

    const now = deps.clock();
    if (
      providerQuote.sourceAmount.currency !== input.sourceCurrency ||
      providerQuote.targetAmount.currency !== input.targetCurrency ||
      providerQuote.fee.currency !== input.sourceCurrency ||
      providerQuote.fee.amountMinor < 0n ||
      providerQuote.fee.amountMinor >= providerQuote.sourceAmount.amountMinor ||
      providerQuote.expiresAt.getTime() <= now.getTime()
    ) {
      // Never store or show a quote that does not match what was asked for.
      throw new ValidationError('The provider returned a quote that does not match the request.');
    }

    const quote = await deps.quoteRepository.create({
      userId: input.userId,
      source: {
        currency: input.sourceCurrency,
        amountMinor: providerQuote.sourceAmount.amountMinor - providerQuote.fee.amountMinor,
      },
      fee: providerQuote.fee,
      target: providerQuote.targetAmount,
      exchangeRate: providerQuote.rate,
      provider: deps.provider.name,
      providerQuoteId: providerQuote.id,
      estimatedDelivery: providerQuote.estimatedDelivery,
      expiresAt: providerQuote.expiresAt,
    });

    await deps.auditLog.record({
      actorType: 'user',
      actorId: input.userId,
      action: 'transfer.quote.created',
      entityType: 'transfer_quote',
      entityId: quote.id,
      context: {
        provider: quote.provider,
        sourceAmountMinor: quote.source.amountMinor.toString(),
        feeAmountMinor: quote.fee.amountMinor.toString(),
        targetAmountMinor: quote.target.amountMinor.toString(),
      },
    });

    return quote;
  };
}
