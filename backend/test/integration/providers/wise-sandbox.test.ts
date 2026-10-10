import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseEnv } from '../../../src/config/env.ts';
import { createWiseProvider } from '../../../src/infrastructure/providers/wise/create-wise-provider.ts';
import { createLogger } from '../../../src/shared/logger.ts';

/**
 * OPT-IN: talks to the real Wise SANDBOX. Runs only when WISE_API_TOKEN (a
 * sandbox personal API token) is set; skipped otherwise, so CI never uses the
 * network. The host is fixed to the sandbox, never taken from the environment.
 *
 * Flow: currencies -> quote GBP->EUR -> recipient (IBAN) -> quote for the
 * recipient -> transfer -> funding instructions -> simulate to completed.
 * Funding a sandbox transfer needs balance funding, which a UK/EU personal
 * token cannot do (PSD2/SCA); the simulation step is then skipped with a message.
 *
 * This has not been run by the author: no sandbox token was available.
 */
const suite = process.env.WISE_API_TOKEN ? test : test.skip;

suite('Wise sandbox: currencies -> quote -> recipient -> transfer -> simulate', async (t) => {
  const env = parseEnv({
    DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    JWT_SECRET: 'x'.repeat(40),
    PAYOUT_PROVIDER: 'wise',
    WISE_AUTH_MODE: 'personal_token',
    WISE_API_TOKEN: process.env.WISE_API_TOKEN,
    WISE_API_BASE_URL: 'https://api.wise-sandbox.com',
  });
  const provider = createWiseProvider({
    env,
    logger: createLogger({ level: 'error', write: () => {} }),
    auditLog: { record: () => Promise.resolve() },
    currencyMinorUnits: () => 2,
  });

  const customer = { id: 'it', email: 'it@example.test' };
  assert.deepEqual(await provider.startCustomerOnboarding(customer, { returnUrl: 'x' }), {
    kind: 'done',
  });
  const { link } = await provider.completeCustomerOnboarding(customer, {});
  assert.equal(await provider.getCustomerStatus(link), 'VERIFIED');

  const currencies = await provider.listCurrencies();
  assert.ok(currencies.some((c) => c.code === 'EUR'));

  const quote = await provider.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });
  assert.ok(quote.targetAmount.amountMinor > 0n);

  const form = await provider.getRecipientForm({ link, quote, currency: 'EUR', country: 'DE' });
  assert.ok(
    form.fields.some((f) => f.key === 'iban'),
    'Wise asks for an IBAN',
  );

  const recipient = await provider.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: {
      recipientAccountType: 'iban',
      accountHolderName: 'Test Recipient',
      legalType: 'PRIVATE',
      iban: 'DE89370400440532013000',
    },
  });
  const priced = await provider.updateQuoteWithRecipient({ link, quote, recipient });

  const questions = await provider.getTransferForm({ link, quote: priced, recipient });
  const answers: Record<string, string> = {};
  for (const field of questions.fields) {
    if (field.required && field.options?.[0]) answers[field.key] = field.options[0].value;
  }
  const transfer = await provider.createTransfer({
    link,
    quote: priced,
    recipient,
    answers,
    idempotencyKey: randomUUID(),
    reference: 'ALMAPAY IT',
  });
  assert.equal(transfer.status, 'AWAITING_FUNDS');

  const instructions = await provider.getFundingInstructions({
    link,
    transfer,
    amount: priced.sourceAmount,
  });
  const bank = instructions.find((i) => i.method === 'BANK_TRANSFER');
  assert.ok(bank && bank.reference, 'bank transfer instructions with a reference');

  const funded = await provider.fundTransfer({ link, transfer, method: 'BALANCE' });
  if (funded.status !== 'PENDING' && funded.status !== 'COMPLETED') {
    t.diagnostic(`Not funded (${funded.status}): skipping the simulation steps.`);
    return;
  }
  for (const state of ['processing', 'funds_converted', 'outgoing_payment_sent']) {
    await new Promise((r) => setTimeout(r, 5_000)); // Wise: >= 5 s between simulations
    await provider.simulateTransferState(link, transfer.id, state);
  }
  assert.equal((await provider.getTransfer({ link, transferRef: transfer.id })).status, 'SENT');
});
