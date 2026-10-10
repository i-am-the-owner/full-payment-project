import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerNotVerifiedError,
  DuplicateError,
  InsufficientFundsError,
  NeedsRelinkError,
  ProviderRejectedError,
  QuoteExpiredError,
  RouteNotSupportedError,
  ValidationFailedError,
} from '../../../../../src/domain/payout/errors.ts';
import type { DynamicForm, ProviderCustomerLink } from '../../../../../src/domain/payout/models.ts';
import { MockPayoutProvider } from '../../../../../src/infrastructure/providers/mock/mock-payout-provider.ts';

const USER = { id: 'u-1', email: 'jane@example.test' };

async function setUp(email = USER.email) {
  let now = new Date('2026-10-03T12:00:00Z');
  const mock = new MockPayoutProvider({ clock: () => now });
  const { link } = await mock.completeCustomerOnboarding({ ...USER, email });
  return {
    mock,
    link,
    advanceClock: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

function keys(form: DynamicForm): string[] {
  return form.fields.map((field) => field.key);
}

const EUR_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

async function quoteRecipientTransfer(mock: MockPayoutProvider, link: ProviderCustomerLink) {
  const quote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });
  const recipient = await mock.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: EUR_VALUES,
  });
  const transfer = await mock.createTransfer({
    link,
    quote,
    recipient,
    answers: { purpose: 'gift' },
    idempotencyKey: 'key-1',
    reference: 'ALM-TEST',
  });
  return { quote, recipient, transfer };
}

// --- Capabilities and currencies --------------------------------------------

test('capabilities and currencies describe the mock corridor set', async () => {
  const { mock } = await setUp();
  const capabilities = await mock.getCapabilities();
  assert.deepEqual(capabilities.sourceCurrencies, ['GBP', 'EUR', 'USD']);
  assert.deepEqual([...capabilities.targetCurrencies].sort(), [
    'EUR',
    'GBP',
    'INR',
    'MXN',
    'NGN',
    'PHP',
    'USD',
  ]);
  assert.equal(capabilities.features.needsCustomerRedirectForKyc, true);
  assert.deepEqual(capabilities.senderCountries, ['GB']);
  assert.deepEqual(capabilities.features.fundingMethods, ['BANK_TRANSFER', 'BALANCE']);

  const currencies = await mock.listCurrencies();
  assert.equal(currencies.length, 7);
  assert.ok(currencies.every((c) => c.minorUnit === 2 && c.name.length > 0));
});

// --- Customers --------------------------------------------------------------

const RETURN_URL = 'http://localhost:3000/api/v1/onboarding/callback?state=abc';

test('onboarding redirects to the mock identity page, which returns to our callback', async () => {
  const { mock } = await setUp();
  const started = await mock.startCustomerOnboarding(USER, { returnUrl: RETURN_URL });
  assert.equal(started.kind, 'redirect');
  if (started.kind !== 'redirect') return;

  const page = new URL(started.url);
  assert.equal(page.origin, 'http://localhost:3000');
  assert.equal(page.pathname, '/dev/mock/kyc');
  assert.equal(page.searchParams.get('return_url'), RETURN_URL);
  // The customer exists at the provider from this point, still unverified.
  assert.ok(started.link);
  assert.equal(await mock.getCustomerStatus(started.link), 'PENDING');
});

test('the outcome chosen on the mock page decides the customer status', async () => {
  const { mock } = await setUp();
  for (const [outcome, status] of [
    ['approved', 'VERIFIED'],
    ['pending', 'PENDING'],
    ['rejected', 'REJECTED'],
    ['relink', 'NEEDS_RELINK'],
  ] as const) {
    const { link } = await mock.completeCustomerOnboarding(USER, { mock_outcome: outcome });
    assert.equal(link.provider, 'mock');
    assert.equal(await mock.getCustomerStatus(link), status);
  }
});

test('the mock reports the verified identity, and can report a mismatching one', async () => {
  const { mock } = await setUp();
  const profile = {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-04-12',
    countryOfResidence: 'GB',
    phone: '+447700900123',
  };
  const same = await mock.completeCustomerOnboarding({ ...USER, profile }, {});
  assert.deepEqual(same.verifiedIdentity, {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-04-12',
  });
  const different = await mock.completeCustomerOnboarding(
    { ...USER, email: 'jane+mismatch@example.test', profile },
    {},
  );
  assert.equal(different.verifiedIdentity?.dateOfBirth, '1901-01-01');
  const rejected = await mock.completeCustomerOnboarding(
    { ...USER, profile },
    { mock_outcome: 'rejected' },
  );
  assert.equal(rejected.verifiedIdentity, undefined);
});

test('test emails onboard as pending, rejected or needing a relink', async () => {
  for (const [tag, status] of [
    ['+pending', 'PENDING'],
    ['+rejected', 'REJECTED'],
    ['+relink', 'NEEDS_RELINK'],
  ] as const) {
    const { mock, link } = await setUp(`jane${tag}@example.test`);
    assert.equal(await mock.getCustomerStatus(link), status);
  }
});

test('a link from another provider, or a made-up one, needs relinking', async () => {
  const { mock } = await setUp();
  assert.equal(
    await mock.getCustomerStatus({ provider: 'wise', customerRef: '123' }),
    'NEEDS_RELINK',
  );
  assert.equal(
    await mock.getCustomerStatus({ provider: 'mock', customerRef: 'forged' }),
    'NEEDS_RELINK',
  );
});

test('an unverified customer cannot get a quote', async () => {
  const pending = await setUp('jane+pending@example.test');
  await assert.rejects(
    pending.mock.createQuote({
      link: pending.link,
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmountMinor: 10_000n,
    }),
    CustomerNotVerifiedError,
  );
  const relink = await setUp('jane+relink@example.test');
  await assert.rejects(
    relink.mock.createQuote({
      link: relink.link,
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmountMinor: 10_000n,
    }),
    NeedsRelinkError,
  );
});

// --- Quotes -----------------------------------------------------------------

test('a source-amount quote is exact integer arithmetic and expires in 30 minutes', async () => {
  const { mock, link } = await setUp();
  const quote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n, // GBP 100.00
  });
  // fee = 0.4% of 100.00 + 0.50 = 0.90; (100.00 - 0.90) * 1.17 = 115.947 -> 115.94
  assert.equal(quote.rate, '1.17');
  assert.deepEqual(quote.fee, { currency: 'GBP', amountMinor: 90n });
  assert.deepEqual(quote.sourceAmount, { currency: 'GBP', amountMinor: 10_000n });
  assert.deepEqual(quote.targetAmount, { currency: 'EUR', amountMinor: 11_594n });
  assert.equal(quote.expiresAt.toISOString(), '2026-10-03T12:30:00.000Z');
  assert.ok(quote.estimatedDelivery instanceof Date);
});

test('a target-amount quote delivers at least the requested amount', async () => {
  const { mock, link } = await setUp();
  const quote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'INR',
    targetAmountMinor: 1_000_000n, // INR 10,000.00
  });
  assert.equal(quote.targetAmount.amountMinor, 1_000_000n);
  assert.equal(quote.rate, '105.5');
  const principal = quote.sourceAmount.amountMinor - quote.fee.amountMinor;
  assert.ok((principal * 1055n) / 10n >= 1_000_000n, 'the converted principal covers the target');
  assert.ok(quote.fee.amountMinor > 0n);
});

test('quotes reject unsupported routes and out-of-range or ambiguous amounts', async () => {
  const { mock, link } = await setUp();
  await assert.rejects(
    mock.createQuote({
      link,
      sourceCurrency: 'INR',
      targetCurrency: 'GBP',
      sourceAmountMinor: 10_000n,
    }),
    RouteNotSupportedError,
  );
  await assert.rejects(
    mock.createQuote({
      link,
      sourceCurrency: 'GBP',
      targetCurrency: 'JPY',
      sourceAmountMinor: 10_000n,
    }),
    RouteNotSupportedError,
  );
  await assert.rejects(
    mock.createQuote({
      link,
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmountMinor: 50n,
    }),
    ValidationFailedError,
  );
  await assert.rejects(
    mock.createQuote({ link, sourceCurrency: 'GBP', targetCurrency: 'EUR' }),
    ValidationFailedError,
  );
  await assert.rejects(
    mock.createQuote({
      link,
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmountMinor: 10_000n,
      targetAmountMinor: 10_000n,
    }),
    ValidationFailedError,
  );
});

// --- Recipient forms --------------------------------------------------------

test('each currency has its own recipient form', async () => {
  const { mock, link } = await setUp();
  const form = (currency: string, country: string) =>
    mock.getRecipientForm({ link, currency, country });

  assert.ok(keys(await form('EUR', 'DE')).includes('iban'));
  assert.deepEqual(keys(await form('USD', 'US')).slice(2), [
    'routingNumber',
    'accountNumber',
    'accountType',
  ]);
  assert.ok(keys(await form('INR', 'IN')).includes('ifsc'));
  assert.deepEqual(keys(await form('MXN', 'MX')).slice(2), ['clabe']);
  assert.ok(keys(await form('GBP', 'GB')).includes('sortCode'));
  assert.ok(keys(await form('NGN', 'NG')).includes('bankCode'));
});

test('forms carry groups, validation rules and options', async () => {
  const { mock, link } = await setUp();
  const form = await mock.getRecipientForm({ link, currency: 'USD', country: 'US' });
  assert.deepEqual(
    form.groups.map((g) => g.key),
    ['holder', 'account'],
  );
  const routing = form.fields.find((f) => f.key === 'routingNumber');
  assert.equal(routing?.validation.pattern, '^\\d{9}$');
  assert.equal(routing?.group, 'account');
  const accountType = form.fields.find((f) => f.key === 'accountType');
  assert.equal(accountType?.type, 'select');
  assert.deepEqual(
    accountType?.options?.map((o) => o.value),
    ['CHECKING', 'SAVINGS'],
  );
});

test('a refreshOnChange field changes the form when its value changes', async () => {
  const { mock, link } = await setUp();
  const initial = await mock.getRecipientForm({ link, currency: 'EUR', country: 'DE' });
  assert.equal(initial.fields.find((f) => f.key === 'legalType')?.refreshOnChange, true);
  assert.equal(keys(initial).includes('businessName'), false);

  const refreshed = await mock.getRecipientForm({
    link,
    currency: 'EUR',
    country: 'DE',
    partialValues: { legalType: 'BUSINESS' },
  });
  assert.equal(keys(refreshed).includes('businessName'), true);
});

test('a currency cannot be paid out in the wrong country', async () => {
  const { mock, link } = await setUp();
  await assert.rejects(
    mock.getRecipientForm({ link, currency: 'INR', country: 'DE' }),
    RouteNotSupportedError,
  );
  await assert.rejects(
    mock.createRecipient({ link, currency: 'EUR', country: 'US', values: EUR_VALUES }),
    RouteNotSupportedError,
  );
});

// --- Recipients -------------------------------------------------------------

test('creating a recipient returns a summary only, never the bank details', async () => {
  const { mock, link } = await setUp();
  const recipient = await mock.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: EUR_VALUES,
  });
  assert.deepEqual(Object.keys(recipient).sort(), [
    'accountSummary',
    'country',
    'currency',
    'id',
    'name',
  ]);
  assert.equal(recipient.name, 'Anna Schmidt');
  assert.equal(recipient.accountSummary, 'IBAN ••••3000');
  assert.equal(JSON.stringify(recipient).includes('DE89370400440532013000'), false);
});

test('invalid recipient values come back as field errors', async () => {
  const { mock, link } = await setUp();
  const attempt = mock.createRecipient({
    link,
    currency: 'INR',
    country: 'IN',
    values: { legalType: 'PRIVATE', accountHolderName: 'A', ifsc: 'nope', accountNumber: '12' },
  });
  await assert.rejects(attempt, (error: unknown) => {
    assert.ok(error instanceof ValidationFailedError);
    assert.deepEqual(error.fieldErrors.map((e) => e.field).sort(), [
      'accountHolderName',
      'accountNumber',
      'ifsc',
    ]);
    return true;
  });
});

test('unknown and missing recipient fields are rejected', async () => {
  const { mock, link } = await setUp();
  await assert.rejects(
    mock.createRecipient({
      link,
      currency: 'MXN',
      country: 'MX',
      values: { legalType: 'PRIVATE', accountHolderName: 'Luis Perez', surprise: 'x' },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationFailedError);
      assert.deepEqual(error.fieldErrors.map((e) => e.field).sort(), ['clabe', 'surprise']);
      return true;
    },
  );
});

// --- Transfers --------------------------------------------------------------

test('the transfer form asks for a purpose, and more for INR', async () => {
  const { mock, link } = await setUp();
  const { quote, recipient } = await quoteRecipientTransfer(mock, link);
  assert.deepEqual(keys(await mock.getTransferForm({ link, quote, recipient })), ['purpose']);

  const inrQuote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'INR',
    sourceAmountMinor: 10_000n,
  });
  assert.deepEqual(keys(await mock.getTransferForm({ link, quote: inrQuote, recipient })), [
    'purpose',
    'sourceOfFunds',
  ]);
});

test('a new transfer awaits funds and carries the reference', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);
  assert.equal(transfer.status, 'AWAITING_FUNDS');
  assert.equal(transfer.providerStatus, 'pending_funding');
  assert.equal(transfer.reference, 'ALM-TEST');
});

test('the same idempotency key returns the same transfer; a reused quote is a duplicate', async () => {
  const { mock, link } = await setUp();
  const { quote, recipient, transfer } = await quoteRecipientTransfer(mock, link);
  const params = { link, quote, recipient, answers: { purpose: 'gift' }, reference: 'ALM-TEST' };

  const replay = await mock.createTransfer({ ...params, idempotencyKey: 'key-1' });
  assert.equal(replay.id, transfer.id);

  await assert.rejects(mock.createTransfer({ ...params, idempotencyKey: 'key-2' }), DuplicateError);

  const other = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 5_000n,
  });
  await assert.rejects(
    mock.createTransfer({ ...params, quote: other, idempotencyKey: 'key-1' }),
    DuplicateError,
  );
});

test('an expired quote cannot create a transfer', async () => {
  const { mock, link, advanceClock } = await setUp();
  const quote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });
  const recipient = await mock.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: EUR_VALUES,
  });
  advanceClock(30 * 60 * 1000);
  await assert.rejects(
    mock.createTransfer({
      link,
      quote,
      recipient,
      answers: { purpose: 'gift' },
      idempotencyKey: 'late',
      reference: 'ALM-LATE',
    }),
    QuoteExpiredError,
  );
});

test('a transfer needs valid answers and a recipient in the quote currency', async () => {
  const { mock, link } = await setUp();
  const quote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });
  const eur = await mock.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: EUR_VALUES,
  });
  const mxn = await mock.createRecipient({
    link,
    currency: 'MXN',
    country: 'MX',
    values: { legalType: 'PRIVATE', accountHolderName: 'Luis Perez', clabe: '032180000118359719' },
  });
  const base = { link, quote, idempotencyKey: 'k', reference: 'ALM-X' };
  await assert.rejects(
    mock.createTransfer({ ...base, recipient: eur, answers: {} }),
    ValidationFailedError,
  );
  await assert.rejects(
    mock.createTransfer({ ...base, recipient: mxn, answers: { purpose: 'gift' } }),
    ValidationFailedError,
  );
});

test("one customer cannot use another customer's quote, recipient or transfer", async () => {
  const { mock, link } = await setUp();
  const { link: other } = await mock.completeCustomerOnboarding({
    id: 'u-2',
    email: 'bob@example.test',
  });
  const { quote, recipient, transfer } = await quoteRecipientTransfer(mock, link);

  await assert.rejects(
    mock.createTransfer({
      link: other,
      quote,
      recipient,
      answers: { purpose: 'gift' },
      idempotencyKey: 'theirs',
      reference: 'ALM-NOPE',
    }),
    QuoteExpiredError,
  );
  await assert.rejects(
    mock.getTransfer({ link: other, transferRef: transfer.id }),
    ProviderRejectedError,
  );
});

// --- Funding ----------------------------------------------------------------

test('funding instructions point at the provider, with the provider’s own payment reference', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);
  const [bank, balance] = await mock.getFundingInstructions({ link, transfer });
  assert.equal(bank?.method, 'BANK_TRANSFER');
  if (bank?.method === 'BANK_TRANSFER') {
    assert.match(bank.reference, /^MOCK[0-9A-F]{8}$/);
    assert.deepEqual(bank.amount, { currency: 'GBP', amountMinor: 10_000n });
    assert.ok(bank.bankDetails.some((d) => d.value.includes('Mock Payments')));
  }
  assert.equal(balance?.method, 'BALANCE');
});

test('funding from balance completes, needs SCA, or lacks funds depending on the amount', async () => {
  const { mock, link } = await setUp();
  const fund = async (sourceAmountMinor: bigint, key: string) => {
    const quote = await mock.createQuote({
      link,
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmountMinor,
    });
    const recipient = await mock.createRecipient({
      link,
      currency: 'EUR',
      country: 'DE',
      values: EUR_VALUES,
    });
    const transfer = await mock.createTransfer({
      link,
      quote,
      recipient,
      answers: { purpose: 'gift' },
      idempotencyKey: key,
      reference: `ALM-${key}`,
    });
    return { transfer, result: mock.fundTransfer({ link, transfer, method: 'BALANCE' }) };
  };

  const small = await fund(10_000n, 'small');
  assert.equal((await small.result).status, 'COMPLETED');
  assert.equal(
    (await mock.getTransfer({ link, transferRef: small.transfer.id })).status,
    'PROCESSING',
  );

  assert.equal((await (await fund(600_000n, 'sca')).result).status, 'SCA_REQUIRED');
  await assert.rejects((await fund(2_500_000n, 'big')).result, InsufficientFundsError);
});

test('paying by bank transfer is pending: the customer pays outside the API', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);
  assert.equal(
    (await mock.fundTransfer({ link, transfer, method: 'BANK_TRANSFER' })).status,
    'PENDING',
  );
});

// --- Cancellation -----------------------------------------------------------

test('a transfer can be cancelled only before it is funded', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);
  await mock.cancelTransfer({ link, transfer });
  assert.equal((await mock.getTransfer({ link, transferRef: transfer.id })).status, 'CANCELLED');
  await assert.rejects(mock.cancelTransfer({ link, transfer }), ProviderRejectedError);
});

// --- Webhooks ---------------------------------------------------------------

test('advancing a transfer walks it to COMPLETED and emits signed webhooks', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);

  const seen: (string | null)[] = [];
  for (let step = 0; step < 3; step += 1) {
    const webhook = mock.advanceTransfer(transfer.id);
    assert.equal(mock.verifyWebhook(webhook.headers, webhook.rawBody), true);
    const event = mock.parseWebhook(webhook.rawBody);
    assert.equal(event.type, 'transfer.status_changed');
    assert.equal(event.providerTransferId, transfer.id);
    seen.push(event.newStatus);
  }
  assert.deepEqual(seen, ['PROCESSING', 'SENT', 'COMPLETED']);
  assert.throws(() => mock.advanceTransfer(transfer.id), ValidationFailedError);
});

test('a transfer can be advanced to an explicit status', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);
  const event = mock.parseWebhook(mock.advanceTransfer(transfer.id, 'rejected').rawBody);
  assert.equal(event.newStatus, 'FAILED');
  assert.equal(event.providerStatus, 'rejected');
});

test('a tampered, unsigned or foreign-signed webhook is not verified', async () => {
  const { mock, link } = await setUp();
  const { transfer } = await quoteRecipientTransfer(mock, link);
  const webhook = mock.advanceTransfer(transfer.id);

  assert.equal(mock.verifyWebhook({}, webhook.rawBody), false);
  assert.equal(mock.verifyWebhook({ 'x-mock-signature': 'zz' }, webhook.rawBody), false);
  const tampered = Buffer.from(webhook.rawBody.toString().replace('funded', 'delivered'));
  assert.equal(mock.verifyWebhook(webhook.headers, tampered), false);

  const stranger = new MockPayoutProvider();
  const forged = stranger.signWebhook(JSON.parse(webhook.rawBody.toString()));
  assert.equal(mock.verifyWebhook(forged.headers, forged.rawBody), false);
});

test('an unrecognised webhook body parses to an unknown event', async () => {
  const { mock } = await setUp();
  assert.equal(mock.parseWebhook(Buffer.from('not json')).type, 'unknown');
  assert.equal(mock.parseWebhook(Buffer.from('{"event":"something.else"}')).type, 'unknown');
  const badDate = mock.parseWebhook(
    Buffer.from(
      JSON.stringify({
        event: 'transfer.updated',
        transfer_id: 't',
        status: 'funded',
        occurred_at: 'x',
      }),
    ),
  );
  assert.equal(badDate.type, 'unknown');
});

test('a transfer can be looked up by the idempotency key it was created with', async () => {
  const { mock, link } = await setUp();
  assert.equal(await mock.findTransferByIdempotencyKey({ link, idempotencyKey: 'key-1' }), null);

  const { transfer } = await quoteRecipientTransfer(mock, link);
  const found = await mock.findTransferByIdempotencyKey({ link, idempotencyKey: 'key-1' });
  assert.equal(found?.id, transfer.id);
  assert.equal(found?.status, 'AWAITING_FUNDS');
  assert.equal(mock.transferCount, 1);

  // Another customer's key is not visible.
  const { link: other } = await mock.completeCustomerOnboarding({
    id: 'u-9',
    email: 'eve@example.test',
  });
  assert.equal(
    await mock.findTransferByIdempotencyKey({ link: other, idempotencyKey: 'key-1' }),
    null,
  );
});

test('paying a business re-prices the quote; a person keeps the original price', async () => {
  const { mock, link } = await setUp();
  const quote = await mock.createQuote({
    link,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });
  const person = await mock.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: EUR_VALUES,
  });
  const business = await mock.createRecipient({
    link,
    currency: 'EUR',
    country: 'DE',
    values: { ...EUR_VALUES, legalType: 'BUSINESS', businessName: 'Schmidt GmbH' },
  });

  const same = await mock.updateQuoteWithRecipient({ link, quote, recipient: person });
  assert.deepEqual(same, quote);

  const dearer = await mock.updateQuoteWithRecipient({ link, quote, recipient: business });
  assert.equal(dearer.id, quote.id);
  assert.equal(dearer.sourceAmount.amountMinor, quote.sourceAmount.amountMinor);
  assert.equal(dearer.fee.amountMinor, quote.fee.amountMinor + 50n);
  assert.ok(dearer.targetAmount.amountMinor < quote.targetAmount.amountMinor);

  // Switching back to a person restores the first price.
  assert.deepEqual(await mock.updateQuoteWithRecipient({ link, quote, recipient: person }), quote);
});

test('the recipient forms cover IBAN, account + routing, IFSC and CLABE; the type is a radio', async () => {
  const { mock, link } = await setUp();
  const fields = async (currency: string, country: string) =>
    (await mock.getRecipientForm({ link, currency, country })).fields;

  const eur = await fields('EUR', 'DE');
  assert.deepEqual(
    eur.map((f) => f.key),
    ['legalType', 'accountHolderName', 'iban', 'bic'],
  );
  assert.equal(eur[0]?.type, 'radio');
  assert.equal(eur[0]?.refreshOnChange, true);
  assert.equal(eur.find((f) => f.key === 'bic')?.required, false);

  assert.deepEqual(
    (await fields('USD', 'US')).slice(2).map((f) => `${f.key}:${f.type}`),
    ['routingNumber:text', 'accountNumber:text', 'accountType:select'],
  );
  assert.deepEqual(
    (await fields('INR', 'IN')).slice(2).map((f) => f.key),
    ['ifsc', 'accountNumber'],
  );
  assert.deepEqual(
    (await fields('MXN', 'MX')).slice(2).map((f) => [f.key, f.validation.pattern]),
    [['clabe', '^\\d{18}$']],
  );
});
