import test from 'node:test';
import assert from 'node:assert/strict';
import { NotImplementedError } from '../../../../../src/domain/payout/errors.ts';
import { CurrencycloudPayoutProvider } from '../../../../../src/infrastructure/providers/currencycloud/currencycloud-payout-provider.ts';

test('every Currencycloud operation throws NotImplemented and makes no network call', async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => {
    called += 1;
    return Promise.reject(new Error('no network in tests'));
  };
  try {
    const provider = new CurrencycloudPayoutProvider();
    assert.equal(provider.name, 'currencycloud');
    const calls: (() => Promise<unknown>)[] = [
      () => provider.getCapabilities(),
      () => provider.startCustomerOnboarding(),
      () => provider.completeCustomerOnboarding(),
      () => provider.getCustomerStatus(),
      () => provider.listCurrencies(),
      () => provider.createQuote(),
      () => provider.getRecipientForm(),
      () => provider.createRecipient(),
      () => provider.updateQuoteWithRecipient(),
      () => provider.getTransferForm(),
      () => provider.createTransfer(),
      () => provider.getFundingInstructions(),
      () => provider.fundTransfer(),
      () => provider.getTransfer(),
      () => provider.cancelTransfer(),
    ];
    for (const call of calls) {
      await assert.rejects(call(), NotImplementedError);
    }
    assert.equal(provider.verifyWebhook(), false);
    assert.throws(() => provider.parseWebhook(), NotImplementedError);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
