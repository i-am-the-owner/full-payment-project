import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  ProviderRejectedError,
  RouteNotSupportedError,
  ValidationFailedError,
} from '../../../../../src/domain/payout/errors.ts';
import type {
  PayoutQuote,
  PayoutRecipient,
  PayoutTransfer,
} from '../../../../../src/domain/payout/models.ts';
import { createLogger } from '../../../../../src/shared/logger.ts';
import { WiseApiClient } from '../../../../../src/infrastructure/providers/wise/wise-api-client.ts';
import { WiseHttpClient } from '../../../../../src/infrastructure/providers/wise/wise-http-client.ts';
import { WisePayoutProvider } from '../../../../../src/infrastructure/providers/wise/wise-payout-provider.ts';
import { WiseUserTokenManager } from '../../../../../src/infrastructure/providers/wise/wise-user-tokens.ts';
import { RsaWiseWebhookVerifier } from '../../../../../src/infrastructure/providers/wise/wise-webhook-verifier.ts';
import {
  handlerTransport,
  RecordingAuditLog,
  wiseFixture,
  type FakeResponseSpec,
  type RecordedRequest,
} from '../../../../support/wise-fakes.ts';

/**
 * Every Wise operation, against mocked HTTP. The response shapes follow Wise's
 * documentation (docs.wise.com, 2026Q4); no network is used.
 */

const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const TOKEN = 'personal-token-abcdef-0123456789';
const LINK = { provider: 'wise' as const, customerRef: '14575282', profileRef: '14575282' };

interface Built {
  provider: WisePayoutProvider;
  requests: RecordedRequest[];
  logLines: string[];
}

function build(
  route: (req: RecordedRequest) => FakeResponseSpec,
  options: { mode?: 'personal_token' | 'oauth_partner'; oauth?: boolean; now?: () => Date } = {},
): Built {
  const { transport, requests } = handlerTransport(route);
  const logLines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (_l, line) => logLines.push(line) });
  const http = new WiseHttpClient({
    baseUrl: 'https://api.wise-sandbox.com',
    timeoutMs: 5_000,
    maxRetries: 0,
    getAuthToken: () => Promise.resolve(TOKEN),
    invalidateAuthToken: () => {},
    logger,
    transport,
  });
  const api = (profileId: string): WiseApiClient =>
    new WiseApiClient({
      http,
      profileId,
      isSandbox: true,
      auditLog: new RecordingAuditLog(),
      currencyMinorUnits: () => 2,
      apiVersion: '2026Q4',
    });
  const stored = new Map<string, string>();
  const tokens = new WiseUserTokenManager({
    baseUrl: 'https://api.wise-sandbox.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    transport,
    timeoutMs: 5_000,
    store: {
      read: (ref) => Promise.resolve(stored.get(ref) ?? null),
      save: (ref, t) => Promise.resolve(void stored.set(ref, t)),
    },
  });
  const provider = new WisePayoutProvider({
    mode: options.mode ?? 'personal_token',
    clientFor: (profileId) => api(profileId),
    appClient: () => api('0'),
    sourceCurrencies: ['GBP'],
    webhookVerifier: new RsaWiseWebhookVerifier(publicKey),
    ...(options.now ? { clock: options.now } : {}),
    ...(options.oauth
      ? {
          oauth: {
            authorizeUrl: 'https://wise.example/oauth/authorize',
            clientId: 'client-id',
            redirectUri: 'https://api.almapay.example/api/v1/onboarding/callback',
            tokens,
            listProfilesWith: (accessToken: string) => {
              assert.ok(accessToken);
              return api('0').listProfiles();
            },
          },
        }
      : {}),
  });
  return { provider, requests, logLines };
}

const json = (body: unknown, status = 200): FakeResponseSpec => ({ status, body });

// --- Documented response shapes ---------------------------------------------------------

const IBAN_FIELDS = {
  type: 'iban',
  title: 'IBAN',
  fields: [
    {
      name: 'Recipient type',
      group: [
        {
          key: 'legalType',
          name: 'Recipient type',
          type: 'select',
          refreshRequirementsOnChange: true,
          required: true,
          valuesAllowed: [
            { key: 'PRIVATE', name: 'Person' },
            { key: 'BUSINESS', name: 'Business' },
          ],
        },
      ],
    },
    {
      name: 'Full name',
      group: [
        {
          key: 'accountHolderName',
          name: 'Full name of the account holder',
          type: 'text',
          required: true,
          refreshRequirementsOnChange: false,
          minLength: 2,
          maxLength: 140,
        },
      ],
    },
    {
      name: 'Bank account',
      group: [
        {
          key: 'iban',
          name: 'IBAN',
          type: 'text',
          required: true,
          refreshRequirementsOnChange: false,
          example: 'DE89370400440532013000',
          validationRegexp: '^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$',
          minLength: 15,
          maxLength: 34,
        },
        {
          key: 'address.country',
          name: 'Country',
          type: 'select',
          required: true,
          refreshRequirementsOnChange: true,
          valuesAllowed: [{ key: 'DE', name: 'Germany' }],
        },
      ],
    },
  ],
};
const SORT_CODE = {
  type: 'sort_code',
  title: 'UK sort code',
  fields: [
    {
      name: 'Bank account',
      group: [
        {
          key: 'sortCode',
          name: 'Sort code',
          type: 'text',
          required: true,
          validationRegexp: '^\\d{6}$',
        },
        { key: 'accountNumber', name: 'Account number', type: 'text', required: true },
      ],
    },
  ],
};
const EMAIL = {
  type: 'email',
  title: 'Email',
  fields: [
    { name: 'Email', group: [{ key: 'email', name: 'Email', type: 'text', required: true }] },
  ],
};

const QUOTE: PayoutQuote = {
  id: '11144c35-9fe8-4c32-b7fd-d05c2a7734bf',
  rate: '1.17',
  fee: { currency: 'GBP', amountMinor: 90n },
  sourceAmount: { currency: 'GBP', amountMinor: 10_000n },
  targetAmount: { currency: 'EUR', amountMinor: 11_594n },
  expiresAt: new Date('2099-01-01'),
  estimatedDelivery: undefined,
};
const RECIPIENT: PayoutRecipient = {
  id: '40000000',
  name: 'Anna Schmidt',
  currency: 'EUR',
  country: 'DE',
  accountSummary: 'IBAN ••••3000',
};
const TRANSFER: PayoutTransfer = {
  id: '80106743',
  status: 'AWAITING_FUNDS',
  providerStatus: 'incoming_payment_waiting',
  reference: 'ALM-1',
};

// --- Currencies and capabilities ----------------------------------------------------------------

test('currencies come from Wise, are cached for 24 hours, and use the documented dated path', async () => {
  let now = new Date('2026-10-03T10:00:00Z');
  const { provider, requests } = build(
    () =>
      json([
        { code: 'GBP', name: 'British Pound', symbol: '£' },
        { code: 'EUR', name: 'Euro', symbol: '€' },
        { code: 'JPY', name: 'Japanese Yen', symbol: '¥', supportsDecimals: false },
        { code: 'xx', name: 'Lower case is ignored' },
        { code: 'bad', name: 'ignored' },
      ]),
    { now: () => now },
  );

  const list = await provider.listCurrencies();
  assert.deepEqual(
    list.map((c) => [c.code, c.minorUnit]),
    [
      ['GBP', 2],
      ['EUR', 2],
      ['JPY', 0],
    ],
  );
  assert.equal(requests[0]?.url, 'https://api.wise-sandbox.com/2026Q4/currencies');
  assert.equal(requests[0]?.method, 'GET');

  await provider.listCurrencies();
  assert.equal(requests.length, 1, 'served from the cache');
  now = new Date(now.getTime() + 25 * 3600_000);
  await provider.listCurrencies();
  assert.equal(requests.length, 2, 'refetched after a day');
});

test('capabilities: sources from configuration, targets from Wise, funding by mode', async () => {
  const routes = () =>
    json([
      { code: 'EUR', name: 'Euro' },
      { code: 'USD', name: 'US dollar' },
    ]);
  const sandbox = await build(routes).provider.getCapabilities();
  assert.deepEqual(sandbox.sourceCurrencies, ['GBP']);
  assert.deepEqual(sandbox.targetCurrencies, ['EUR', 'USD']);
  assert.equal(sandbox.features.needsCustomerRedirectForKyc, false);
  // A personal token cannot fund from balance in the UK/EU.
  assert.deepEqual(sandbox.features.fundingMethods, ['BANK_TRANSFER']);

  const partner = await build(routes, { mode: 'oauth_partner' }).provider.getCapabilities();
  assert.equal(partner.features.needsCustomerRedirectForKyc, true);
  assert.deepEqual(partner.features.fundingMethods, ['BANK_TRANSFER', 'BALANCE']);
});

// --- Recipient form --------------------------------------------------------------------------------

test('the recipient form is Wise’s account requirements for the quote, converted to our form', async () => {
  const { provider, requests } = build(() => json([IBAN_FIELDS, SORT_CODE, EMAIL]));
  const form = await provider.getRecipientForm({
    link: LINK,
    quote: QUOTE,
    currency: 'EUR',
    country: 'DE',
  });

  assert.equal(requests[0]?.method, 'GET');
  assert.equal(
    requests[0]?.url,
    `https://api.wise-sandbox.com/2026Q4/quotes/${QUOTE.id}/account-requirements`,
  );
  assert.equal(requests[0]?.headers['Accept-Minor-Version'], '1');
  assert.equal(requests[0]?.headers.authorization, `Bearer ${TOKEN}`);

  const byKey = Object.fromEntries(form.fields.map((f) => [f.key, f]));
  // The account type is a choice; email recipients are not offered.
  assert.deepEqual(byKey.recipientAccountType?.options, [
    { value: 'iban', label: 'IBAN' },
    { value: 'sort_code', label: 'UK sort code' },
  ]);
  assert.equal(byKey.recipientAccountType?.refreshOnChange, true);
  // Wise's fields, rules and flags are kept.
  assert.equal(byKey.legalType?.type, 'select');
  assert.equal(byKey.legalType?.refreshOnChange, true);
  assert.deepEqual(byKey.legalType?.options, [
    { value: 'PRIVATE', label: 'Person' },
    { value: 'BUSINESS', label: 'Business' },
  ]);
  assert.deepEqual(byKey.iban?.validation, {
    pattern: '^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$',
    minLength: 15,
    maxLength: 34,
  });
  assert.equal(byKey.iban?.example, 'DE89370400440532013000');
  assert.equal(byKey['address.country']?.refreshOnChange, true);
  assert.equal(byKey.accountHolderName?.required, true);
  // Only the first type's fields are shown until the customer chooses another.
  assert.equal(byKey.sortCode, undefined);
  assert.ok(form.groups.some((g) => g.label === 'Bank account'));
  // Every field belongs to a group the form describes.
  for (const field of form.fields) {
    assert.ok(
      form.groups.some((g) => g.key === field.group),
      field.key,
    );
  }
});

test('choosing another account type, or a field that refreshes the form, re-posts the values so far', async () => {
  const { provider, requests } = build((req) =>
    json(req.method === 'POST' ? [SORT_CODE, IBAN_FIELDS] : [IBAN_FIELDS]),
  );
  const form = await provider.getRecipientForm({
    link: LINK,
    quote: QUOTE,
    currency: 'GBP',
    country: 'GB',
    partialValues: {
      recipientAccountType: 'sort_code',
      accountHolderName: 'John Doe',
      legalType: 'PRIVATE',
      'address.country': 'GB',
    },
  });

  const post = requests[0]!;
  assert.equal(post.method, 'POST');
  assert.equal(
    post.url,
    `https://api.wise-sandbox.com/2026Q4/quotes/${QUOTE.id}/account-requirements`,
  );
  assert.deepEqual(JSON.parse(post.body ?? '{}'), {
    type: 'sort_code',
    profile: 14575282,
    ownedByCustomer: false,
    accountHolderName: 'John Doe',
    details: { legalType: 'PRIVATE', address: { country: 'GB' } },
  });
  assert.ok(form.fields.some((f) => f.key === 'sortCode'));
  assert.ok(!form.fields.some((f) => f.key === 'iban'));
  // The name field Wise did not list is added, since a recipient always needs one.
  assert.ok(form.fields.some((f) => f.key === 'accountHolderName'));
});

test('a recipient form needs a quote and a route Wise can pay a bank account on', async () => {
  const { provider } = build(() => json([EMAIL]));
  await assert.rejects(
    provider.getRecipientForm({ link: LINK, currency: 'EUR', country: 'DE' }),
    ValidationFailedError,
  );
  await assert.rejects(
    provider.getRecipientForm({ link: LINK, quote: QUOTE, currency: 'EUR', country: 'DE' }),
    (error: unknown) =>
      error instanceof ValidationFailedError &&
      /cannot pay out to a bank account/.test(error.fieldErrors[0]?.message ?? ''),
  );
});

// --- Creating the recipient ------------------------------------------------------------------------

test('a recipient is created from the form values, and only the last four characters are kept', async () => {
  const { provider, requests } = build(() =>
    json({
      id: 40000000,
      profileId: 14575282,
      currency: 'EUR',
      country: 'DE',
      type: 'iban',
      active: true,
      accountSummary: 'DE89 3704 0044 0532 0130 00',
      details: { IBAN: 'DE89370400440532013000', legalType: 'PRIVATE' },
      commonFieldMap: { accountNumberField: 'IBAN' },
      name: { fullName: 'Anna Schmidt' },
    }),
  );
  const created = await provider.createRecipient({
    link: LINK,
    currency: 'EUR',
    country: 'DE',
    values: {
      recipientAccountType: 'iban',
      accountHolderName: ' Anna Schmidt ',
      legalType: 'PRIVATE',
      iban: 'DE89370400440532013000',
      'address.country': 'DE',
      empty: '',
    },
  });

  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.url, 'https://api.wise-sandbox.com/2026Q4/accounts');
  assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), {
    currency: 'EUR',
    type: 'iban',
    profile: 14575282,
    ownedByCustomer: false,
    accountHolderName: 'Anna Schmidt',
    details: { legalType: 'PRIVATE', iban: 'DE89370400440532013000', address: { country: 'DE' } },
  });
  assert.deepEqual(created, {
    id: '40000000',
    name: 'Anna Schmidt',
    currency: 'EUR',
    country: 'DE',
    accountSummary: 'IBAN ••••3000',
  });
  // Wise's own summary (the whole IBAN) is not what we keep or log.
  assert.ok(!JSON.stringify(created).includes('DE893704'));
});

test('a recipient without an account type or a name is refused before Wise is called', async () => {
  const { provider, requests } = build(() => json({}));
  await assert.rejects(
    provider.createRecipient({ link: LINK, currency: 'EUR', country: 'DE', values: { iban: 'x' } }),
    (error: unknown) =>
      error instanceof ValidationFailedError &&
      error.fieldErrors.map((f) => f.field).join() === 'recipientAccountType,accountHolderName',
  );
  assert.equal(requests.length, 0);
});

test('Wise validation errors name the field they are about', async () => {
  const { provider } = build(() =>
    json({ errors: [{ code: 'NOT_VALID', message: 'Please check the IBAN', path: 'iban' }] }, 422),
  );
  await assert.rejects(
    provider.createRecipient({
      link: LINK,
      currency: 'EUR',
      country: 'DE',
      values: { recipientAccountType: 'iban', accountHolderName: 'Anna', iban: 'DE00' },
    }),
    (error: unknown) =>
      error instanceof ValidationFailedError &&
      error.fieldErrors[0]?.field === 'iban' &&
      error.fieldErrors[0].message === 'Please check the IBAN',
  );
});

// --- Pricing for a recipient -----------------------------------------------------------------------

test('the quote is priced for the recipient with a merge-patch of targetAccount', async () => {
  const { provider, requests } = build(() => json(wiseFixture('quote.json')));
  const priced = await provider.updateQuoteWithRecipient({
    link: LINK,
    quote: QUOTE,
    recipient: RECIPIENT,
  });

  const patch = requests[0]!;
  assert.equal(patch.method, 'PATCH');
  assert.equal(
    patch.url,
    `https://api.wise-sandbox.com/2026Q4/profiles/14575282/quotes/${QUOTE.id}`,
  );
  assert.equal(patch.headers['content-type'], 'application/merge-patch+json');
  assert.deepEqual(JSON.parse(patch.body ?? '{}'), { targetAccount: 40000000 });
  // Our own type comes back, with amounts as integer minor units.
  assert.equal(typeof priced.sourceAmount.amountMinor, 'bigint');
  assert.equal(priced.fee.currency, priced.sourceAmount.currency);
});

// --- Transfer questions ----------------------------------------------------------------------------

test('the transfer form is Wise’s transfer requirements, and answers so far are sent back', async () => {
  const { provider, requests } = build(() =>
    json([
      {
        type: 'transfer',
        fields: [
          {
            name: 'Why are you sending money?',
            group: [
              {
                key: 'transferPurpose',
                name: 'Purpose of the transfer',
                type: 'select',
                required: true,
                refreshRequirementsOnChange: true,
                valuesAllowed: [
                  { key: 'verification.transfers.purpose.pay.bills', name: 'Paying bills' },
                  { key: 'verification.transfers.purpose.other', name: 'Other' },
                ],
              },
              { key: 'reference', name: 'Reference', type: 'text', required: false, maxLength: 35 },
            ],
          },
        ],
      },
    ]),
  );
  const form = await provider.getTransferForm({
    link: LINK,
    quote: QUOTE,
    recipient: RECIPIENT,
    partialValues: { transferPurpose: 'verification.transfers.purpose.other' },
  });

  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.url, 'https://api.wise-sandbox.com/2026Q4/transfer-requirements');
  assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), {
    targetAccount: 40000000,
    quoteUuid: QUOTE.id,
    originatorLegalEntityType: 'PRIVATE',
    details: { transferPurpose: 'verification.transfers.purpose.other' },
  });
  assert.deepEqual(
    form.fields.map((f) => [f.key, f.type, f.required, f.refreshOnChange]),
    [
      ['transferPurpose', 'select', true, true],
      ['reference', 'text', false, false],
    ],
  );
  assert.equal(form.fields[1]?.validation.maxLength, 35);
});

// --- Creating the transfer -----------------------------------------------------------------------------

test('the transfer carries our UUID as customerTransactionId and the answers as details', async () => {
  const { provider, requests } = build(() => json(wiseFixture('transfer-created.json')));
  await provider.createTransfer({
    link: LINK,
    quote: QUOTE,
    recipient: RECIPIENT,
    answers: { transferPurpose: 'verification.transfers.purpose.pay.bills' },
    idempotencyKey: '5a1e0b0e-0000-4000-8000-000000000001',
    reference: 'ALM-1',
  });
  assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), {
    targetAccount: 40000000,
    quoteUuid: QUOTE.id,
    customerTransactionId: '5a1e0b0e-0000-4000-8000-000000000001',
    details: { transferPurpose: 'verification.transfers.purpose.pay.bills', reference: 'ALM-1' },
  });
});

// --- Paying ----------------------------------------------------------------------------------------------

test('bank transfer instructions are Wise’s own details with the documented T<id> reference', async () => {
  const { provider, requests } = build(() =>
    json({
      payinBank: { bankName: 'Wise Europe SA/NV', bankAddress: { country: 'BE' } },
      payinBankAccount: {
        currency: 'GBP',
        bankAccountType: 'RECIPIENT',
        details: [
          { label: 'Sort code', value: '23-14-70' },
          { label: 'Account number', value: '12345678' },
        ],
      },
      wiseInformation: { localCompanyName: 'Wise Payments Limited' },
    }),
  );
  const [bank, ...others] = await provider.getFundingInstructions({
    link: LINK,
    transfer: TRANSFER,
    amount: { currency: 'GBP', amountMinor: 10_000n },
  });

  assert.equal(
    requests[0]?.url,
    'https://api.wise-sandbox.com/2026Q4/profiles/14575282/transfers/80106743/deposit-details/bank-transfer',
  );
  assert.deepEqual(others, [], 'no balance option with a personal token');
  assert.ok(bank?.method === 'BANK_TRANSFER');
  assert.equal(bank.reference, 'T80106743');
  assert.deepEqual(bank.amount, { currency: 'GBP', amountMinor: 10_000n });
  assert.deepEqual(bank.bankDetails, [
    { label: 'Account holder', value: 'Wise Payments Limited' },
    { label: 'Bank', value: 'Wise Europe SA/NV' },
    { label: 'Sort code', value: '23-14-70' },
    { label: 'Account number', value: '12345678' },
  ]);
});

test('balance is offered as a second way to pay only with partner OAuth', async () => {
  const deposit = json({ payinBankAccount: { details: [{ label: 'IBAN', value: 'BE00' }] } });
  const { provider } = build(() => deposit, { mode: 'oauth_partner' });
  const methods = await provider.getFundingInstructions({
    link: LINK,
    transfer: TRANSFER,
    amount: { currency: 'EUR', amountMinor: 500n },
  });
  assert.deepEqual(
    methods.map((m) => m.method),
    ['BANK_TRANSFER', 'BALANCE'],
  );
});

test('choosing bank transfer changes nothing at Wise; the customer pays from their bank', async () => {
  const { provider, requests } = build(() => json({}));
  assert.deepEqual(
    await provider.fundTransfer({ link: LINK, transfer: TRANSFER, method: 'BANK_TRANSFER' }),
    { status: 'PENDING', errorCode: undefined },
  );
  assert.equal(requests.length, 0);
});

test('a personal token that Wise will not let fund from balance gives a clean refusal, not an error', async () => {
  for (const response of [
    { status: 403 } as FakeResponseSpec,
    { status: 403, headers: { 'x-2fa-approval': 'one-time-token' } } as FakeResponseSpec,
  ]) {
    const { provider } = build(() => response);
    assert.deepEqual(
      await provider.fundTransfer({ link: LINK, transfer: TRANSFER, method: 'BALANCE' }),
      { status: 'REJECTED', errorCode: 'balance_funding_not_available' },
    );
  }
});

test('with partner OAuth, strong customer authentication on balance funding is reported as such', async () => {
  const { provider } = build(
    () => ({ status: 403, headers: { 'x-2fa-approval': 'one-time-token' } }),
    { mode: 'oauth_partner' },
  );
  assert.deepEqual(
    await provider.fundTransfer({ link: LINK, transfer: TRANSFER, method: 'BALANCE' }),
    { status: 'SCA_REQUIRED', errorCode: undefined },
  );
});

// --- Customers -------------------------------------------------------------------------------------------

const PROFILES = [
  { type: 'BUSINESS', id: 999, currentState: 'VISIBLE' },
  { type: 'PERSONAL', id: 14575282, currentState: 'VISIBLE' },
];
const USER = { id: 'u1', email: 'jane@example.test' };

test('personal_token mode links the token’s own personal profile, with no redirect', async () => {
  const { provider, requests } = build(() => json(PROFILES));
  assert.deepEqual(
    await provider.startCustomerOnboarding(USER, { returnUrl: 'https://api.example/cb?state=s' }),
    { kind: 'done' },
  );
  const completed = await provider.completeCustomerOnboarding(USER, {});
  assert.deepEqual(completed.link, {
    provider: 'wise',
    customerRef: '14575282',
    profileRef: '14575282',
  });
  // Nothing to compare with the profile the customer typed in sandbox testing.
  assert.equal(completed.verifiedIdentity, undefined);
  assert.equal(completed.refreshToken, undefined);
  assert.equal(requests[0]?.url, 'https://api.wise-sandbox.com/2026Q4/profiles');

  const none = build(() => json([PROFILES[0]]));
  await assert.rejects(none.provider.completeCustomerOnboarding(USER, {}), ProviderRejectedError);
});

test('a customer’s status is read from their Wise profile', async () => {
  const status = async (state: string | undefined) =>
    build(() =>
      json(state ? [{ type: 'PERSONAL', id: 14575282, currentState: state }] : []),
    ).provider.getCustomerStatus(LINK);
  assert.equal(await status('VISIBLE'), 'VERIFIED');
  assert.equal(await status('HIDDEN'), 'PENDING');
  assert.equal(await status('DEACTIVATED'), 'REJECTED');
  assert.equal(await status(undefined), 'NEEDS_RELINK');
});

test('partner OAuth sends the customer to Wise’s authorise page with our state, and never fakes it', async () => {
  const { provider } = build(() => json({}), { mode: 'oauth_partner', oauth: true });
  const started = await provider.startCustomerOnboarding(USER, {
    returnUrl: 'https://api.almapay.example/api/v1/onboarding/callback?state=our-state-123',
  });
  assert.equal(started.kind, 'redirect');
  if (started.kind !== 'redirect') return;
  const url = new URL(started.url);
  assert.equal(url.origin + url.pathname, 'https://wise.example/oauth/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: 'client-id',
    redirect_uri: 'https://api.almapay.example/api/v1/onboarding/callback',
    response_type: 'code',
    state: 'our-state-123',
  });
  await assert.rejects(
    provider.startCustomerOnboarding(USER, { returnUrl: 'https://api.almapay.example/cb' }),
    ProviderRejectedError,
  );
});

test('partner OAuth exchanges the code for tokens, links the profile and returns the refresh token', async () => {
  const { provider, requests } = build(
    (req) =>
      req.url.endsWith('/oauth/token')
        ? json({
            access_token: 'user-access-1',
            refresh_token: 'user-refresh-1',
            expires_in: 43199,
            token_type: 'bearer',
          })
        : json(PROFILES),
    { mode: 'oauth_partner', oauth: true },
  );
  const completed = await provider.completeCustomerOnboarding(USER, {
    code: 'auth-code-xyz',
    state: 'ignored',
  });

  const exchange = requests[0]!;
  assert.equal(exchange.url, 'https://api.wise-sandbox.com/oauth/token');
  assert.equal(exchange.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(
    exchange.headers.authorization,
    `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
  );
  assert.deepEqual(Object.fromEntries(new URLSearchParams(exchange.body)), {
    grant_type: 'authorization_code',
    code: 'auth-code-xyz',
    redirect_uri: 'https://api.almapay.example/api/v1/onboarding/callback',
  });
  assert.deepEqual(completed.link, {
    provider: 'wise',
    customerRef: '14575282',
    profileRef: '14575282',
  });
  assert.equal(completed.refreshToken, 'user-refresh-1');
  assert.ok(
    !JSON.stringify(completed).includes('user-access-1'),
    'an access token is never returned to be stored',
  );

  await assert.rejects(provider.completeCustomerOnboarding(USER, {}), ProviderRejectedError);
  await assert.rejects(
    provider.completeCustomerOnboarding(USER, { error: 'access_denied' }),
    ProviderRejectedError,
  );
});

// --- Every status maps; and no token reaches a log -------------------------------------------------

test('every Wise transfer state maps to a documented internal status', async () => {
  const states: Record<string, string | null> = {
    incoming_payment_waiting: 'AWAITING_FUNDS',
    incoming_payment_initiated: 'PROCESSING',
    processing: 'PROCESSING',
    funds_converted: 'PROCESSING',
    outgoing_payment_sent: 'SENT',
    bounced_back: 'FAILED',
    charged_back: 'FAILED',
    cancelled: 'CANCELLED',
    funds_refunded: 'REFUNDED',
    some_future_state: null,
  };
  for (const [wise, expected] of Object.entries(states)) {
    const { provider } = build(() =>
      json({ ...wiseFixture<object>('transfer-created.json'), status: wise }),
    );
    assert.equal(
      (await provider.getTransfer({ link: LINK, transferRef: '1' })).status,
      expected,
      wise,
    );
  }
});

test('no token, bank detail or name reaches the log across a whole send flow', async () => {
  const { provider, logLines } = build((req) => {
    if (req.url.endsWith('/currencies')) return json([{ code: 'EUR', name: 'Euro' }]);
    if (req.url.includes('/account-requirements')) return json([IBAN_FIELDS]);
    if (req.url.endsWith('/accounts'))
      return json({
        id: 40000000,
        currency: 'EUR',
        details: { IBAN: 'DE89370400440532013000' },
        commonFieldMap: { accountNumberField: 'IBAN' },
      });
    if (req.url.includes('/transfer-requirements')) return json([{ type: 'transfer', fields: [] }]);
    if (req.url.includes('/deposit-details'))
      return json({
        payinBankAccount: { details: [{ label: 'IBAN', value: 'BE68539007547034' }] },
      });
    if (req.method === 'PATCH') return json(wiseFixture('quote.json'));
    return json(wiseFixture('transfer-created.json'));
  });
  await provider.listCurrencies();
  await provider.getRecipientForm({ link: LINK, quote: QUOTE, currency: 'EUR', country: 'DE' });
  await provider.createRecipient({
    link: LINK,
    currency: 'EUR',
    country: 'DE',
    values: {
      recipientAccountType: 'iban',
      accountHolderName: 'Anna Schmidt',
      iban: 'DE89370400440532013000',
    },
  });
  await provider.updateQuoteWithRecipient({ link: LINK, quote: QUOTE, recipient: RECIPIENT });
  await provider.getTransferForm({ link: LINK, quote: QUOTE, recipient: RECIPIENT });
  await provider.createTransfer({
    link: LINK,
    quote: QUOTE,
    recipient: RECIPIENT,
    answers: {},
    idempotencyKey: 'k',
    reference: 'r',
  });
  await provider.getFundingInstructions({
    link: LINK,
    transfer: TRANSFER,
    amount: { currency: 'EUR', amountMinor: 1n },
  });

  const log = logLines.join('\n');
  assert.ok(log.includes('provider.request'), 'requests are logged');
  for (const secret of [
    TOKEN,
    'DE89370400440532013000',
    'BE68539007547034',
    'Anna Schmidt',
    'Bearer',
  ]) {
    assert.ok(!log.includes(secret), `${secret} must not be logged`);
  }
});

test('Wise error.route.not.supported becomes RouteNotSupported', async () => {
  const { provider } = build(() =>
    json({ errors: [{ code: 'error.route.not.supported', message: 'No route' }] }, 422),
  );
  await assert.rejects(
    provider.createQuote({
      link: LINK,
      sourceCurrency: 'GBP',
      targetCurrency: 'EUR',
      sourceAmountMinor: 100n,
    }),
    RouteNotSupportedError,
  );
});
