import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { QuoteExpiredError } from '../../domain/payout/errors.ts';
import type { TransferQuote } from '../../domain/transfer/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { requireVerifiedLink } from '../payout/customer-onboarding.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import { toPayoutQuote, toPayoutRecipient } from './mappers.ts';
import type { CustomerLinkStore, QuoteRepository, RecipientRepository } from './ports.ts';

export interface QuoteForRecipient {
  readonly quote: TransferQuote;
  /** True when the provider's price for this recipient differs from the first quote. */
  readonly priceChanged: boolean;
}

export type AttachRecipientToQuote = (input: {
  userId: string;
  quoteId: string;
  recipientId: string;
}) => Promise<QuoteForRecipient>;

/**
 * Asks the provider to price the quote for a specific recipient. Stored quotes
 * are immutable, so a changed price is saved as a NEW quote, which is the one
 * the customer must review and confirm. The first quote is left as it was.
 */
export function createAttachRecipientToQuote(deps: {
  provider: PayoutProvider;
  customerLinkStore: CustomerLinkStore;
  quoteRepository: QuoteRepository;
  recipientRepository: RecipientRepository;
  auditLog: AuditLog;
  clock: () => Date;
}): AttachRecipientToQuote {
  return async (input) => {
    const link = await requireVerifiedLink(deps, input.userId);

    const stored = await deps.quoteRepository.findById(input.quoteId);
    if (!stored) {
      throw new NotFoundError('That quote could not be found.');
    }
    if (stored.userId !== input.userId) {
      throw new ForbiddenError('That quote belongs to another account.');
    }
    if (
      stored.expiresAt.getTime() <= deps.clock().getTime() ||
      stored.provider !== deps.provider.name
    ) {
      throw new QuoteExpiredError();
    }
    const recipient = await deps.recipientRepository.findById(input.recipientId);
    if (!recipient) {
      throw new NotFoundError('That recipient could not be found.');
    }
    if (recipient.userId !== input.userId) {
      throw new ForbiddenError('That recipient belongs to another account.');
    }
    if (!recipient.isActive) {
      throw new ValidationError('That recipient is no longer active.');
    }
    if (recipient.currencyCode !== stored.target.currency) {
      throw new ValidationError('The recipient currency does not match the quote.');
    }

    const priced = await deps.provider.updateQuoteWithRecipient({
      link,
      quote: toPayoutQuote(stored),
      recipient: toPayoutRecipient(recipient, deps.provider.name),
    });

    if (
      priced.sourceAmount.currency !== stored.source.currency ||
      priced.targetAmount.currency !== stored.target.currency ||
      priced.fee.currency !== stored.source.currency ||
      priced.fee.amountMinor < 0n ||
      priced.fee.amountMinor >= priced.sourceAmount.amountMinor ||
      priced.targetAmount.amountMinor <= 0n
    ) {
      throw new ValidationError('The provider returned a quote that does not match the request.');
    }
    if (priced.expiresAt.getTime() <= deps.clock().getTime()) {
      throw new QuoteExpiredError();
    }

    // Compared on the amounts the customer pays and the recipient gets. (The
    // rate is a decimal string whose formatting may differ once stored.)
    const unchanged =
      priced.sourceAmount.amountMinor === stored.totalToPay.amountMinor &&
      priced.fee.amountMinor === stored.fee.amountMinor &&
      priced.targetAmount.amountMinor === stored.target.amountMinor;
    if (unchanged) {
      return { quote: stored, priceChanged: false };
    }

    const quote = await deps.quoteRepository.create({
      userId: input.userId,
      source: {
        currency: stored.source.currency,
        amountMinor: priced.sourceAmount.amountMinor - priced.fee.amountMinor,
      },
      fee: priced.fee,
      target: priced.targetAmount,
      exchangeRate: priced.rate,
      provider: deps.provider.name,
      providerQuoteId: priced.id,
      estimatedDelivery: priced.estimatedDelivery,
      expiresAt: priced.expiresAt,
    });
    await deps.auditLog.record({
      actorType: 'provider',
      action: 'transfer.quote.repriced',
      entityType: 'transfer_quote',
      entityId: quote.id,
      context: {
        previousQuoteId: stored.id,
        recipientId: recipient.id,
        feeAmountMinor: quote.fee.amountMinor.toString(),
        targetAmountMinor: quote.target.amountMinor.toString(),
      },
    });
    return { quote, priceChanged: true };
  };
}
