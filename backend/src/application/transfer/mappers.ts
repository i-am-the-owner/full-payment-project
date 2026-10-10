import type {
  PayoutQuote,
  PayoutRecipient,
  PayoutTransfer,
  ProviderName,
} from '../../domain/payout/models.ts';
import { QuoteExpiredError } from '../../domain/payout/errors.ts';
import { ValidationError } from '../../shared/errors.ts';
import type { Recipient, Transfer, TransferQuote } from '../../domain/transfer/models.ts';

/** Rebuilds the provider's view of a quote from our stored copy. */
export function toPayoutQuote(quote: TransferQuote): PayoutQuote {
  if (!quote.providerQuoteId) {
    throw new QuoteExpiredError('That quote can no longer be used. Please request a new one.');
  }
  return {
    id: quote.providerQuoteId,
    rate: quote.exchangeRate,
    fee: quote.fee,
    sourceAmount: quote.totalToPay,
    targetAmount: quote.target,
    expiresAt: quote.expiresAt,
    estimatedDelivery: quote.estimatedDelivery,
  };
}

export function toPayoutRecipient(recipient: Recipient, provider: ProviderName): PayoutRecipient {
  if (recipient.provider !== provider || !recipient.providerRecipientId) {
    throw new ValidationError('That recipient cannot be used. Please add the recipient again.');
  }
  return {
    id: recipient.providerRecipientId,
    name: recipient.accountHolderName,
    currency: recipient.currencyCode,
    country: recipient.countryCode,
    accountSummary: recipient.accountSummary,
  };
}

export function toPayoutTransferRef(transfer: Transfer): PayoutTransfer | null {
  if (!transfer.providerTransferId) {
    return null;
  }
  return {
    id: transfer.providerTransferId,
    status: transfer.status,
    providerStatus: transfer.providerStatus ?? '',
    reference: transfer.reference,
  };
}
