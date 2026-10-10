import { createAddRecipient } from '../../src/application/transfer/add-recipient.ts';
import { createConfirmTransfer } from '../../src/application/transfer/confirm-transfer.ts';
import { createRequestQuote } from '../../src/application/transfer/request-quote.ts';
import type { Recipient, TransferQuote } from '../../src/domain/transfer/models.ts';
import { EUR_RECIPIENT_VALUES, USER, type World } from './transfer-fakes.ts';

/** The three use cases a transfer needs, wired to one in-memory world. */
export function useCases(world: World, options: { balanceFunding?: boolean } = {}) {
  return {
    requestQuote: createRequestQuote(world),
    addRecipient: createAddRecipient(world),
    confirmTransfer: createConfirmTransfer({
      ...world,
      balanceFundingEnabled: options.balanceFunding ?? false,
    }),
  };
}

/** A GBP -> EUR quote and a matching recipient, both created through the provider. */
export async function quoteAndRecipient(
  world: World,
  sourceAmountMinor = 10_000n,
): Promise<{ quote: TransferQuote; recipient: Recipient }> {
  const { requestQuote, addRecipient } = useCases(world);
  const quote = await requestQuote({
    userId: USER,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor,
  });
  const recipient = await addRecipient({
    userId: USER,
    currency: 'EUR',
    country: 'DE',
    values: EUR_RECIPIENT_VALUES,
  });
  world.calls.length = 0;
  return { quote, recipient };
}

export const ANSWERS = { purpose: 'family_support' };
