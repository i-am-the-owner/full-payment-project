import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseEnv } from '../../../src/config/env.ts';
import { createAirwallexProvider } from '../../../src/infrastructure/providers/airwallex/create-airwallex-provider.ts';
import { createLogger } from '../../../src/shared/logger.ts';

/**
 * OPT-IN: talks to the real Airwallex SANDBOX. It runs only when all of these
 * are set, and is skipped otherwise (so CI never touches the network):
 *
 *   AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY   sandbox credentials
 *   AIRWALLEX_TEST_ACCOUNT_ID                an ACTIVE sandbox connected account
 *                                            (acct_...) with a funded GBP Wallet
 *
 * It refuses to run against anything but the sandbox host. It has not been run
 * by the author of this adapter: no sandbox credentials were available.
 */
const ready = Boolean(
  process.env.AIRWALLEX_CLIENT_ID &&
  process.env.AIRWALLEX_API_KEY &&
  process.env.AIRWALLEX_TEST_ACCOUNT_ID,
);
const suite = ready ? test : test.skip;

suite(
  'Airwallex sandbox: currencies -> quote GBP->EUR -> beneficiary (IBAN) -> transfer -> PAID',
  async () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
      JWT_SECRET: 'x'.repeat(40),
      PAYOUT_PROVIDER: 'airwallex',
      AIRWALLEX_CLIENT_ID: process.env.AIRWALLEX_CLIENT_ID,
      AIRWALLEX_API_KEY: process.env.AIRWALLEX_API_KEY,
      // Deliberately not taken from the environment: sandbox only.
      AIRWALLEX_BASE_URL: 'https://api.sandbox.airwallex.com',
    });
    const provider = createAirwallexProvider({
      env,
      logger: createLogger({ level: 'error', write: () => {} }),
    });
    const link = {
      provider: 'airwallex' as const,
      customerRef: process.env.AIRWALLEX_TEST_ACCOUNT_ID ?? '',
    };

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

    const form = await provider.getRecipientForm({ link, currency: 'EUR', country: 'DE' });
    assert.ok(form.fields.length > 0);

    const recipient = await provider.createRecipient({
      link,
      currency: 'EUR',
      country: 'DE',
      values: {
        'beneficiary.entity_type': 'PERSONAL',
        'beneficiary.first_name': 'Anna',
        'beneficiary.last_name': 'Schmidt',
        'beneficiary.bank_details.account_name': 'Anna Schmidt',
        'beneficiary.bank_details.iban': 'DE89370400440532013000',
        'beneficiary.bank_details.local_clearing_system': 'SEPA',
        'beneficiary.address.country_code': 'DE',
        'beneficiary.address.city': 'Berlin',
        'beneficiary.address.street_address': 'Unter den Linden 1',
        'beneficiary.address.postcode': '10117',
        transfer_method: 'LOCAL',
      },
    });
    assert.ok(recipient.accountSummary.startsWith('IBAN'));

    const idempotencyKey = randomUUID();
    const params = {
      link,
      quote,
      recipient,
      answers: { reason: 'living_expenses', transfer_method: 'LOCAL' },
      idempotencyKey,
      reference: `ALM-${idempotencyKey.slice(0, 8).toUpperCase()}`,
    };
    const transfer = await provider.createTransfer(params);
    // The same key must return the same transfer, never a second one.
    assert.equal((await provider.createTransfer(params)).id, transfer.id);

    for (const next of ['PROCESSING', 'SENT', 'PAID'] as const) {
      await provider.simulateTransferTransition(link, transfer.id, next);
    }
    const final = await provider.getTransfer({ link, transferRef: transfer.id });
    assert.equal(final.providerStatus, 'PAID');
    assert.equal(final.status, 'COMPLETED');
  },
);
