import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  DuplicateError,
  InsufficientFundsError,
  NotSupportedError,
  ProviderRejectedError,
  ProviderUnavailableError,
  QuoteExpiredError,
  RouteNotSupportedError,
  ValidationFailedError,
} from '../../../../../src/domain/payout/errors.ts';
import type { PayoutQuote } from '../../../../../src/domain/payout/models.ts';
import {
  ACCESS_TOKEN,
  AWX_ENV,
  buildAirwallex,
  LINK,
  NOW,
} from '../../../../support/airwallex-fakes.ts';

const USER = { id: '7c1d5a2e-0000-4000-8000-000000000001', email: 'jane@example.test' };

const CONTEXT = { returnUrl: 'https://api.almapay.example/api/v1/onboarding/callback?state=s' };

const QUOTE: PayoutQuote = {
  id: 'a08c0f2f-3f26-4443-b5df-fad15582eb94',
  rate: '1.17',
  fee: { currency: 'GBP', amountMinor: 0n },
  sourceAmount: { currency: 'GBP', amountMinor: 10_000n },
  targetAmount: { currency: 'EUR', amountMinor: 11_700n },
  expiresAt: new Date('2026-10-03T12:30:00Z'),
  estimatedDelivery: undefined,
};
const RECIPIENT = {
  id: '9a45987e-cffc-4f0a-81d7-82e80f0ce336',
  name: 'Anna Schmidt',
  currency: 'EUR',
  country: 'DE',
  accountSummary: 'IBAN ••••3000',
};
const KEY = '8750f946-39f4-46e5-8a9d-2b2fca63a18a';
const TRANSFER = {
  id: '43217eec-6053-4fe6-b760-6a0d29bf9d51',
  request_id: KEY,
  status: 'SCHEDULED',
  source_currency: 'GBP',
  amount_payer_pays: 100.5,
  funding: { status: 'SCHEDULED' },
};

/** A form schema in the shape documented under "Using API and form schemas". */
const FORM_SCHEMA = {
  condition: { account_currency: 'EUR', bank_country_code: 'DE', entity_type: 'PERSONAL' },
  fields: [
    {
      enabled: true,
      path: 'beneficiary.entity_type',
      required: true,
      field: {
        key: 'entity_type',
        label: 'Recipient account type',
        type: 'RADIO',
        refresh: true,
        options: [
          { label: 'Business', value: 'COMPANY' },
          { label: 'Personal', value: 'PERSONAL' },
        ],
      },
      rule: { type: 'string', pattern: 'COMPANY|PERSONAL' },
    },
    {
      enabled: true,
      path: 'beneficiary.bank_details.account_currency',
      required: true,
      field: {
        key: 'account_currency',
        label: 'Account currency',
        type: 'SELECT',
        refresh: true,
        options: [
          { label: 'EUR', value: 'EUR' },
          { label: 'JPY', value: 'JPY' },
        ],
      },
      rule: { type: 'string', pattern: 'EUR|GBP|JPY|KWD|USD' },
    },
    {
      enabled: true,
      path: 'beneficiary.bank_details.bank_country_code',
      required: true,
      field: { key: 'bank_country_code', label: 'Bank country', type: 'SELECT', options: [] },
      rule: { type: 'string', pattern: 'DE|FR' },
    },
    {
      enabled: true,
      path: 'beneficiary.bank_details.iban',
      required: true,
      field: { key: 'iban', label: 'IBAN', type: 'INPUT', refresh: false, example: 'DE89…' },
      rule: { type: 'string', pattern: '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}' },
    },
    {
      enabled: true,
      path: 'beneficiary.bank_details.swift_code',
      required: false,
      field: { key: 'swift_code', label: 'SWIFT code', type: 'DYNAMIC_SELECT' },
      rule: { type: 'string', pattern: '^[A-Z0-9]{8,11}$' },
    },
    {
      enabled: false,
      path: 'beneficiary.address.city',
      required: false,
      field: { key: 'city', label: 'City', type: 'INPUT' },
    },
  ],
};

// --- Authentication ---------------------------------------------------------

test('logs in once with the client id and API key, then reuses the token', async () => {
  const { provider, requests } = buildAirwallex((req) =>
    req.path.startsWith('/api/v1/accounts/')
      ? { status: 200, body: { status: 'ACTIVE' } }
      : undefined,
  );
  await provider.getCustomerStatus(LINK);
  await provider.getCustomerStatus(LINK);

  const logins = requests.filter((r) => r.url.endsWith('/api/v1/authentication/login'));
  assert.equal(logins.length, 1);
  assert.equal(logins[0]?.method, 'POST');
  assert.equal(logins[0]?.headers['x-client-id'], AWX_ENV.AIRWALLEX_CLIENT_ID);
  assert.equal(logins[0]?.headers['x-api-key'], AWX_ENV.AIRWALLEX_API_KEY);
  // The API key is never sent on an ordinary call; the bearer token is.
  const call = requests.find((r) => r.url.includes('/accounts/'));
  assert.equal(call?.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(call?.headers['x-api-key'], undefined);
});

test('a rejected token is refreshed once and the call retried', async () => {
  let calls = 0;
  const { provider, requests } = buildAirwallex(() => {
    calls += 1;
    return calls === 1
      ? { status: 401, body: { code: 'credentials_expired' } }
      : { status: 200, body: { status: 'ACTIVE' } };
  });
  assert.equal(await provider.getCustomerStatus(LINK), 'VERIFIED');
  assert.equal(requests.filter((r) => r.url.endsWith('/login')).length, 2);
});

test('a failed login is reported without echoing the response or the credentials', async () => {
  const { tokens } = buildAirwallex(() => undefined);
  const { AirwallexTokenProvider } =
    await import('../../../../../src/infrastructure/providers/airwallex/airwallex-token-provider.ts');
  const failing = new AirwallexTokenProvider({
    baseUrl: 'https://api.sandbox.airwallex.com',
    clientId: 'client',
    apiKey: 'API-KEY-SECRET',
    timeoutMs: 1000,
    transport: () =>
      Promise.resolve({
        status: 401,
        headers: { get: () => null },
        text: () => Promise.resolve('{"code":"credentials_invalid","echo":"API-KEY-SECRET"}'),
      }),
  });
  await assert.rejects(failing.getToken(), (error: unknown) => {
    assert.ok(error instanceof ProviderUnavailableError);
    assert.equal(String(error.message).includes('API-KEY-SECRET'), false);
    return true;
  });
  assert.ok(tokens);
});

test('no token, API key or body ever reaches the logs; every line has a request id', async () => {
  const { provider, logLines } = buildAirwallex((req) =>
    req.path === '/api/v1/beneficiaries/create'
      ? {
          status: 201,
          body: {
            id: RECIPIENT.id,
            beneficiary: { bank_details: { iban: 'DE89370400440532013000' } },
          },
        }
      : undefined,
  );
  await provider.createRecipient({
    link: LINK,
    currency: 'EUR',
    country: 'DE',
    values: { 'beneficiary.bank_details.iban': 'DE89370400440532013000' },
  });
  const output = logLines.join('\n');
  assert.ok(logLines.length > 0);
  for (const secret of [
    ACCESS_TOKEN,
    AWX_ENV.AIRWALLEX_API_KEY,
    'DE89370400440532013000',
    LINK.customerRef,
  ]) {
    assert.equal(output.includes(secret), false, secret);
  }
  for (const line of logLines) {
    assert.match(line, /"requestId":"[0-9a-f-]{36}"/);
    assert.match(line, /"provider":"airwallex"/);
  }
});

// --- Capabilities and currencies --------------------------------------------

test('currencies come from the form schema, with ISO 4217 minor units, cached for 24 hours', async () => {
  const { provider, apiRequests } = buildAirwallex((req) =>
    req.path === '/api/v1/beneficiary_form_schemas/generate'
      ? { status: 200, body: FORM_SCHEMA }
      : undefined,
  );
  const currencies = await provider.listCurrencies();
  assert.deepEqual(
    currencies.map((c) => [c.code, c.minorUnit]),
    [
      ['EUR', 2],
      ['JPY', 0],
      ['GBP', 2],
      ['KWD', 3],
      ['USD', 2],
    ],
  );
  assert.equal(currencies[0]?.name, 'Euro');
  await provider.listCurrencies();
  assert.equal(apiRequests().length, 1);
  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? ''), {});
});

test('capabilities list what Airwallex cannot do for individual accounts', async () => {
  const route = () => ({ status: 200, body: FORM_SCHEMA });
  const individual = await buildAirwallex(route).provider.getCapabilities();
  assert.equal(individual.provider, 'airwallex');
  assert.deepEqual(individual.sourceCurrencies, ['GBP']);
  assert.equal(individual.features.needsCustomerRedirectForKyc, true);
  assert.deepEqual(individual.features.fundingMethods, ['BANK_TRANSFER', 'BALANCE']);
  assert.equal(individual.unsupportedOperations.length, 1);
  assert.match(individual.unsupportedOperations[0] ?? '', /business accounts only/);

  const business = await buildAirwallex(route, {
    AIRWALLEX_LEGAL_ENTITY_TYPE: 'BUSINESS',
    AIRWALLEX_SOURCE_CURRENCIES: 'GBP,EUR',
  }).provider.getCapabilities();
  assert.deepEqual(business.unsupportedOperations, []);
  assert.deepEqual(business.sourceCurrencies, ['GBP', 'EUR']);
});

// --- Onboarding -------------------------------------------------------------

const BUSINESS = {
  AIRWALLEX_LEGAL_ENTITY_TYPE: 'BUSINESS',
  AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID: 'tmpl_123',
  AIRWALLEX_ONBOARDING_RETURN_URL: 'https://app.almapay.example/onboarding/done',
};

test('onboarding creates a connected account tagged with our user id, then authorises the hosted flow', async () => {
  const { provider, apiRequests } = buildAirwallex((req) => {
    if (req.method === 'GET' && req.path.startsWith('/api/v1/accounts?')) {
      return { status: 200, body: { items: [] } };
    }
    if (req.path === '/api/v1/accounts/create') {
      return { status: 201, body: { id: 'acct_new', status: 'CREATED' } };
    }
    if (req.path === '/api/v1/hosted_flows/create') {
      return { status: 201, body: { id: 'ahfi_1', status: 'INIT', url: 'https://unauthorised' } };
    }
    if (req.path === '/api/v1/hosted_flows/ahfi_1/authorize') {
      return {
        status: 200,
        body: { id: 'ahfi_1', url: 'https://airwallex.example/hostedflow?code=x' },
      };
    }
    return undefined;
  }, BUSINESS);

  const started = await provider.startCustomerOnboarding(USER, CONTEXT);
  assert.deepEqual(started, {
    kind: 'redirect',
    url: 'https://airwallex.example/hostedflow?code=x',
    link: { provider: 'airwallex', customerRef: 'acct_new' },
  });

  const [find, create, flow, authorise] = apiRequests();
  assert.ok(find?.url.includes(`identifier=${USER.id}`));
  const account = JSON.parse(create?.body ?? '{}') as Record<string, unknown>;
  assert.equal(account.identifier, USER.id);
  assert.deepEqual(account.primary_contact, { email: USER.email });
  assert.deepEqual(account.customer_agreements, {
    agreed_to_terms_and_conditions: true,
    agreed_to_data_usage: true,
  });
  assert.deepEqual(JSON.parse(flow?.body ?? '{}'), {
    account_id: 'acct_new',
    template: 'tmpl_123',
    return_url: BUSINESS.AIRWALLEX_ONBOARDING_RETURN_URL,
  });
  assert.deepEqual(JSON.parse(authorise?.body ?? '{}'), { identity: USER.id });
  // Platform-level calls are not made on behalf of anyone.
  assert.equal(create?.headers['x-on-behalf-of'], undefined);
});

test('an existing account is reused, and an ACTIVE one needs no onboarding', async () => {
  const { provider, apiRequests } = buildAirwallex(
    (req) =>
      req.path.startsWith('/api/v1/accounts?')
        ? {
            status: 200,
            body: { items: [{ id: 'acct_old', status: 'ACTIVE', identifier: USER.id }] },
          }
        : undefined,
    BUSINESS,
  );
  assert.deepEqual(await provider.startCustomerOnboarding(USER, CONTEXT), { kind: 'done' });
  assert.equal(apiRequests().length, 1);
});

test('hosted onboarding is refused for individual accounts and when no template is configured', async () => {
  const route = (req: { path: string }) =>
    req.path.startsWith('/api/v1/accounts?')
      ? { status: 200, body: { items: [{ id: 'acct_x', status: 'CREATED', identifier: USER.id }] } }
      : undefined;
  await assert.rejects(
    buildAirwallex(route).provider.startCustomerOnboarding(USER, CONTEXT),
    (error: unknown) =>
      error instanceof NotSupportedError && /business accounts only/.test(error.message),
  );
  await assert.rejects(
    buildAirwallex(route, {
      AIRWALLEX_LEGAL_ENTITY_TYPE: 'BUSINESS',
    }).provider.startCustomerOnboarding(USER, CONTEXT),
    /AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID/,
  );
});

test('completing onboarding links the account found by OUR user id, ignoring browser parameters', async () => {
  const { provider } = buildAirwallex((req) =>
    req.path.startsWith('/api/v1/accounts?')
      ? {
          status: 200,
          body: {
            items: [
              { id: 'acct_someone_else', status: 'ACTIVE', identifier: 'another-user' },
              { id: 'acct_mine', status: 'SUBMITTED', identifier: USER.id },
            ],
          },
        }
      : undefined,
  );
  assert.deepEqual(await provider.completeCustomerOnboarding(USER), {
    link: { provider: 'airwallex', customerRef: 'acct_mine' },
  });
});

test('completing onboarding fails when no account exists for the customer', async () => {
  const { provider } = buildAirwallex(() => ({ status: 200, body: { items: [] } }));
  await assert.rejects(provider.completeCustomerOnboarding(USER), ProviderRejectedError);
});

test('customer status follows the connected account status', async () => {
  for (const [account, expected] of [
    ['ACTIVE', 'VERIFIED'],
    ['CREATED', 'PENDING'],
    ['SUBMITTED', 'PENDING'],
    ['ACTION_REQUIRED', 'PENDING'],
    ['SUSPENDED', 'REJECTED'],
    ['DORMANT', 'NEEDS_RELINK'],
    ['CLOSED', 'NEEDS_RELINK'],
    ['SOMETHING_NEW', 'NEEDS_RELINK'],
  ] as const) {
    const { provider, apiRequests } = buildAirwallex(() => ({
      status: 200,
      body: { status: account },
    }));
    assert.equal(await provider.getCustomerStatus(LINK), expected, account);
    assert.ok(apiRequests()[0]?.url.endsWith('/api/v1/accounts/acct_customer_1'));
  }
});

// --- Quotes -----------------------------------------------------------------

test('a quote is created on behalf of the customer and returned in minor units', async () => {
  const { provider, apiRequests } = buildAirwallex((req) =>
    req.path === '/api/v1/fx/quotes/create'
      ? {
          status: 201,
          body: {
            quote_id: QUOTE.id,
            client_rate: 1.17,
            currency_pair: 'GBPEUR',
            sell_currency: 'GBP',
            sell_amount: 100,
            buy_currency: 'EUR',
            buy_amount: 117,
            valid_to_at: '2026-10-03T12:30:00+0000',
          },
        }
      : undefined,
  );
  const quote = await provider.createQuote({
    link: LINK,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    sourceAmountMinor: 10_000n,
  });

  const request = apiRequests()[0];
  assert.equal(request?.headers['x-on-behalf-of'], LINK.customerRef);
  assert.equal(request?.headers['x-api-version'], '2026-08-21');
  assert.deepEqual(JSON.parse(request?.body ?? '{}'), {
    sell_currency: 'GBP',
    buy_currency: 'EUR',
    validity: 'MIN_30',
    sell_amount: 100,
  });
  assert.equal(quote.id, QUOTE.id);
  assert.equal(quote.rate, '1.17');
  assert.deepEqual(quote.sourceAmount, { currency: 'GBP', amountMinor: 10_000n });
  assert.deepEqual(quote.targetAmount, { currency: 'EUR', amountMinor: 11_700n });
  assert.deepEqual(quote.fee, { currency: 'GBP', amountMinor: 0n });
  assert.equal(quote.expiresAt.toISOString(), '2026-10-03T12:30:00.000Z');
});

test('a rate quoted in the reverse market direction is inverted exactly; target-amount quotes use buy_amount', async () => {
  const { provider, apiRequests } = buildAirwallex(() => ({
    status: 201,
    body: {
      quote_id: QUOTE.id,
      client_rate: 0.8,
      currency_pair: 'EURGBP',
      sell_amount: 80,
      buy_amount: 100,
      valid_to_at: '2026-10-03T12:30:00+0000',
    },
  }));
  const quote = await provider.createQuote({
    link: LINK,
    sourceCurrency: 'GBP',
    targetCurrency: 'EUR',
    targetAmountMinor: 10_000n,
  });
  assert.equal(quote.rate, '1.25');
  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? '{}'), {
    sell_currency: 'GBP',
    buy_currency: 'EUR',
    validity: 'MIN_30',
    buy_amount: 100,
  });
});

test('zero-decimal currencies are not scaled by 100', async () => {
  const { provider, apiRequests } = buildAirwallex(() => ({
    status: 201,
    body: {
      quote_id: QUOTE.id,
      client_rate: 190.5,
      currency_pair: 'GBPJPY',
      sell_amount: 100,
      buy_amount: 19050,
      valid_to_at: '2026-10-03T12:30:00+0000',
    },
  }));
  const quote = await provider.createQuote({
    link: LINK,
    sourceCurrency: 'GBP',
    targetCurrency: 'JPY',
    targetAmountMinor: 19_050n,
  });
  assert.equal(
    (JSON.parse(apiRequests()[0]?.body ?? '{}') as { buy_amount: number }).buy_amount,
    19050,
  );
  assert.deepEqual(quote.targetAmount, { currency: 'JPY', amountMinor: 19_050n });
});

test('quote errors are translated: unsupported pair, both or neither amount', async () => {
  const { provider } = buildAirwallex(() => ({
    status: 400,
    body: { code: 'currency_pair_invalid', source: 'buy_currency', message: 'Invalid pair' },
  }));
  const base = { link: LINK, sourceCurrency: 'GBP', targetCurrency: 'XXX' };
  await assert.rejects(
    provider.createQuote({ ...base, sourceAmountMinor: 100n }),
    RouteNotSupportedError,
  );
  await assert.rejects(provider.createQuote(base), ValidationFailedError);
  await assert.rejects(
    provider.createQuote({ ...base, sourceAmountMinor: 1n, targetAmountMinor: 1n }),
    ValidationFailedError,
  );
});

// --- Recipient form and beneficiaries ---------------------------------------

test('the beneficiary form schema becomes a DynamicForm keyed by request path', async () => {
  const { provider, apiRequests } = buildAirwallex(() => ({ status: 200, body: FORM_SCHEMA }));
  const form = await provider.getRecipientForm({
    link: LINK,
    currency: 'EUR',
    country: 'DE',
    partialValues: { 'beneficiary.entity_type': 'COMPANY', transfer_method: 'SWIFT' },
  });

  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? '{}'), {
    account_currency: 'EUR',
    bank_country_code: 'DE',
    entity_type: 'COMPANY',
    transfer_method: 'SWIFT',
  });
  assert.equal(apiRequests()[0]?.headers['x-on-behalf-of'], LINK.customerRef);

  // Currency and country are fixed by the request; disabled fields are dropped.
  assert.deepEqual(
    form.fields.map((f) => f.key),
    [
      'beneficiary.entity_type',
      'beneficiary.bank_details.iban',
      'beneficiary.bank_details.swift_code',
    ],
  );
  const [entity, iban, swift] = form.fields;
  assert.equal(entity?.type, 'select');
  assert.equal(entity?.refreshOnChange, true);
  assert.deepEqual(entity?.options, [
    { value: 'COMPANY', label: 'Business' },
    { value: 'PERSONAL', label: 'Personal' },
  ]);
  assert.equal(iban?.type, 'text');
  assert.equal(iban?.required, true);
  assert.equal(iban?.validation.pattern, '^(?:[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30})$');
  assert.equal(iban?.example, 'DE89…');
  // A dynamic select cannot be listed up front: it is a validated text field.
  assert.equal(swift?.type, 'text');
  assert.equal(swift?.validation.pattern, '^[A-Z0-9]{8,11}$');
  assert.deepEqual(form.groups, [
    { key: 'recipient', label: 'Recipient' },
    { key: 'bank_details', label: 'Bank account' },
  ]);
});

test('the form defaults to a personal recipient paid by local transfer', async () => {
  const { provider, apiRequests } = buildAirwallex(() => ({ status: 200, body: FORM_SCHEMA }));
  await provider.getRecipientForm({ link: LINK, currency: 'EUR', country: 'DE' });
  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? '{}'), {
    account_currency: 'EUR',
    bank_country_code: 'DE',
    entity_type: 'PERSONAL',
    transfer_method: 'LOCAL',
  });
});

test('an unsupported form scenario is a route error', async () => {
  const { provider } = buildAirwallex(() => ({
    status: 400,
    body: { code: 'SCHEMA_DEFINITION_NOT_FOUND', message: 'not found' },
  }));
  await assert.rejects(
    provider.getRecipientForm({ link: LINK, currency: 'EUR', country: 'ZZ' }),
    RouteNotSupportedError,
  );
});

test('creating a recipient nests the form values and returns a summary only', async () => {
  const { provider, apiRequests } = buildAirwallex(() => ({
    status: 201,
    body: {
      id: RECIPIENT.id,
      beneficiary: {
        entity_type: 'PERSONAL',
        first_name: 'Anna',
        last_name: 'Schmidt',
        bank_details: { account_name: 'Anna Schmidt', iban: 'DE89370400440532013000' },
      },
    },
  }));
  const recipient = await provider.createRecipient({
    link: LINK,
    currency: 'EUR',
    country: 'DE',
    values: {
      'beneficiary.entity_type': 'PERSONAL',
      'beneficiary.first_name': 'Anna',
      'beneficiary.bank_details.iban': 'DE89370400440532013000',
      'beneficiary.bank_details.account_name': 'Anna Schmidt',
      transfer_method: 'SWIFT',
      // Unsafe or empty keys are ignored.
      '__proto__.polluted': 'yes',
      'beneficiary.address.city': '',
    },
  });

  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? '{}'), {
    beneficiary: {
      entity_type: 'PERSONAL',
      first_name: 'Anna',
      bank_details: {
        iban: 'DE89370400440532013000',
        account_name: 'Anna Schmidt',
        account_currency: 'EUR',
        bank_country_code: 'DE',
      },
    },
    transfer_methods: ['SWIFT'],
  });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(recipient, RECIPIENT);
  assert.equal(JSON.stringify(recipient).includes('DE89370400440532013000'), false);
});

test('a rejected beneficiary names the field', async () => {
  const { provider } = buildAirwallex(() => ({
    status: 400,
    body: {
      code: 'invalid_argument',
      source: 'beneficiary.bank_details.iban',
      message: 'Should be a valid and supported IBAN',
      details: { echoed: 'DE00' },
    },
  }));
  await assert.rejects(
    provider.createRecipient({ link: LINK, currency: 'EUR', country: 'DE', values: {} }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationFailedError);
      assert.deepEqual(error.fieldErrors, [
        { field: 'beneficiary.bank_details.iban', message: 'Should be a valid and supported IBAN' },
      ]);
      return true;
    },
  );
});

test('updating a quote with a recipient is a no-op: Airwallex quotes do not depend on it', async () => {
  const { provider, apiRequests } = buildAirwallex(() => undefined);
  assert.equal(await provider.updateQuoteWithRecipient({ quote: QUOTE }), QUOTE);
  assert.equal(apiRequests().length, 0);
});

// --- Transfers --------------------------------------------------------------

test('the transfer form asks for a documented reason and a transfer method', async () => {
  const form = await buildAirwallex(() => undefined).provider.getTransferForm();
  assert.deepEqual(
    form.fields.map((f) => [f.key, f.required, f.type]),
    [
      ['reason', true, 'select'],
      ['transfer_method', true, 'select'],
    ],
  );
  assert.ok(form.fields[0]?.options?.some((o) => o.value === 'living_expenses'));
  assert.equal(form.fields[0]?.options?.length, 22);
});

const CREATE = {
  link: LINK,
  quote: QUOTE,
  recipient: RECIPIENT,
  answers: { reason: 'living_expenses', transfer_method: 'LOCAL' },
  idempotencyKey: KEY,
  reference: 'ALM-1A2B3C4D5E',
};

test('a transfer is created with our idempotency UUID as request_id and decimal-string amounts', async () => {
  const { provider, apiRequests } = buildAirwallex((req) =>
    req.path === '/api/v1/transfers/create' ? { status: 201, body: TRANSFER } : undefined,
  );
  const transfer = await provider.createTransfer(CREATE);

  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? '{}'), {
    request_id: KEY,
    beneficiary_id: RECIPIENT.id,
    quote_id: QUOTE.id,
    source_currency: 'GBP',
    transfer_currency: 'EUR',
    source_amount: '100.00',
    transfer_method: 'LOCAL',
    reason: 'living_expenses',
    reference: 'ALM-1A2B3C4D5E',
  });
  assert.equal(apiRequests()[0]?.headers['x-on-behalf-of'], LINK.customerRef);
  assert.deepEqual(transfer, {
    id: TRANSFER.id,
    status: 'AWAITING_FUNDS',
    providerStatus: 'SCHEDULED',
    reference: 'ALM-1A2B3C4D5E',
  });
});

test('a transfer without a reason is refused before any call', async () => {
  const { provider, apiRequests } = buildAirwallex(() => undefined);
  await assert.rejects(provider.createTransfer({ ...CREATE, answers: {} }), ValidationFailedError);
  assert.equal(apiRequests().length, 0);
});

test('a timeout on create is NOT retried blindly: the transfer is looked up by request_id', async () => {
  const { provider, apiRequests } = buildAirwallex((req) => {
    if (req.path === '/api/v1/transfers/create') {
      return { status: 503, body: { code: 'service_unavailable' } };
    }
    if (req.path === `/api/v1/transfers?request_id=${KEY}`) {
      return { status: 200, body: { items: [{ ...TRANSFER, status: 'PROCESSING' }] } };
    }
    return undefined;
  });
  const transfer = await provider.createTransfer(CREATE);

  assert.equal(transfer.id, TRANSFER.id);
  assert.equal(transfer.status, 'PROCESSING');
  const creates = apiRequests().filter((r) => r.url.endsWith('/transfers/create'));
  assert.equal(creates.length, 1, 'the create call is sent exactly once');
});

test('when the lookup finds nothing, the uncertain outcome is reported so the transfer stays pending', async () => {
  const { provider } = buildAirwallex((req) =>
    req.path === '/api/v1/transfers/create'
      ? { status: 500, body: {} }
      : { status: 200, body: { items: [] } },
  );
  await assert.rejects(
    provider.createTransfer(CREATE),
    (error: unknown) => error instanceof ProviderUnavailableError && error.outcomeUnknown,
  );
});

test('a repeated request_id returns the transfer that already exists', async () => {
  const { provider } = buildAirwallex((req) =>
    req.path === '/api/v1/transfers/create'
      ? { status: 400, body: { code: 'duplicate_request_id', source: 'request_id' } }
      : { status: 200, body: { items: [TRANSFER] } },
  );
  assert.equal((await provider.createTransfer(CREATE)).id, TRANSFER.id);
});

test('a lookup never returns a transfer with a different request_id', async () => {
  const { provider } = buildAirwallex((req) =>
    req.path === '/api/v1/transfers/create'
      ? { status: 400, body: { code: 'request_id_duplicate' } }
      : { status: 200, body: { items: [{ ...TRANSFER, request_id: 'someone-elses' }] } },
  );
  await assert.rejects(provider.createTransfer(CREATE), DuplicateError);
});

test('definitive create failures are typed: insufficient balance, expired quote', async () => {
  const fail = (code: string) =>
    buildAirwallex(() => ({
      status: 400,
      body: { code, source: 'transfer' },
    })).provider.createTransfer(CREATE);
  await assert.rejects(fail('balance_insufficient'), InsufficientFundsError);
  await assert.rejects(fail('quote_expired'), QuoteExpiredError);
  await assert.rejects(fail('transfer_method_unsupported'), RouteNotSupportedError);
});

test('getTransfer and cancelTransfer call the documented endpoints on behalf of the customer', async () => {
  const { provider, apiRequests } = buildAirwallex((req) => {
    if (req.method === 'GET' && req.path === `/api/v1/transfers/${TRANSFER.id}`) {
      return { status: 200, body: { ...TRANSFER, status: 'PAID' } };
    }
    if (req.method === 'POST' && req.path === `/api/v1/transfers/${TRANSFER.id}/cancel`) {
      return { status: 200, text: '' };
    }
    return undefined;
  });
  const found = await provider.getTransfer({ link: LINK, transferRef: TRANSFER.id });
  assert.equal(found.status, 'COMPLETED');
  assert.equal(found.providerStatus, 'PAID');

  await provider.cancelTransfer({ link: LINK, transfer: found });
  assert.ok(apiRequests().every((r) => r.headers['x-on-behalf-of'] === LINK.customerRef));
});

test('a refused cancellation is a typed rejection', async () => {
  const { provider } = buildAirwallex(() => ({
    status: 400,
    body: { code: 'update_unsupported', message: 'Cannot cancel' },
  }));
  await assert.rejects(
    provider.cancelTransfer({
      link: LINK,
      transfer: { id: TRANSFER.id, status: 'SENT', providerStatus: 'SENT', reference: undefined },
    }),
    ValidationFailedError,
  );
});

// --- Funding ----------------------------------------------------------------

const PAYOUT = {
  id: TRANSFER.id,
  status: 'AWAITING_FUNDS' as const,
  providerStatus: 'SCHEDULED',
  reference: 'r',
};

test('funding instructions are the customer’s own global account and Wallet – never SomPay’s', async () => {
  const { provider, apiRequests } = buildAirwallex((req) => {
    if (req.path === `/api/v1/transfers/${TRANSFER.id}`) return { status: 200, body: TRANSFER };
    if (req.path.startsWith('/api/v1/global_accounts?')) {
      return {
        status: 200,
        body: {
          items: [
            {
              account_number: '88888888',
              iban: 'GB81LHVB04032900176471',
              institution: { name: 'Saxo Payments A/S' },
              supported_features: [
                { currency: 'GBP', routing_codes: [{ type: 'sort_code', value: '040329' }] },
              ],
            },
          ],
        },
      };
    }
    return undefined;
  });
  const [bank, balance] = await provider.getFundingInstructions({ link: LINK, transfer: PAYOUT });

  assert.deepEqual(bank, {
    method: 'BANK_TRANSFER',
    amount: { currency: 'GBP', amountMinor: 10_050n },
    bankDetails: [
      { label: 'Bank', value: 'Saxo Payments A/S' },
      { label: 'IBAN', value: 'GB81LHVB04032900176471' },
      { label: 'Account number', value: '88888888' },
      { label: 'Sort code', value: '040329' },
    ],
    reference: '',
  });
  assert.deepEqual(balance, {
    method: 'BALANCE',
    amount: { currency: 'GBP', amountMinor: 10_050n },
  });
  const accounts = apiRequests().find((r) => r.url.includes('/global_accounts'));
  assert.ok(accounts?.url.includes('supported_features.currency=GBP'));
  assert.equal(accounts?.headers['x-on-behalf-of'], LINK.customerRef);
});

test('without a global account in that currency, only the Wallet balance is offered', async () => {
  const { provider } = buildAirwallex((req) =>
    req.path.startsWith('/api/v1/global_accounts')
      ? { status: 200, body: { items: [] } }
      : { status: 200, body: TRANSFER },
  );
  const instructions = await provider.getFundingInstructions({ link: LINK, transfer: PAYOUT });
  assert.deepEqual(
    instructions.map((i) => i.method),
    ['BALANCE'],
  );
});

test('fundTransfer reports the funding Airwallex performs by itself', async () => {
  for (const [funding, expected] of [
    ['FUNDED', 'COMPLETED'],
    ['SCHEDULED', 'PENDING'],
    ['PROCESSING', 'PENDING'],
    ['REQUIRES_FUNDING_CONFIRMATION', 'PENDING'],
    ['FAILED', 'REJECTED'],
    ['CANCELLED', 'REJECTED'],
  ] as const) {
    const { provider, apiRequests } = buildAirwallex(() => ({
      status: 200,
      body: { ...TRANSFER, funding: { status: funding } },
    }));
    const result = await provider.fundTransfer({ link: LINK, transfer: PAYOUT, method: 'BALANCE' });
    assert.equal(result.status, expected, funding);
    assert.equal(apiRequests()[0]?.method, 'GET', 'it only reads; it moves no money');
  }
});

// --- Webhooks ---------------------------------------------------------------

function signed(body: unknown, secret = AWX_ENV.AIRWALLEX_WEBHOOK_SECRET, at = NOW.getTime()) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(at);
  const signature = createHmac('sha256', secret)
    .update(timestamp + rawBody.toString())
    .digest('hex');
  return { rawBody, headers: { 'x-timestamp': timestamp, 'x-signature': signature } };
}

const EVENT = {
  id: 'afcee0a3-ea9d-4ce7-88d2-c92f971a6e24',
  name: 'payout.transfer.sent',
  account_id: 'acct_customer_1',
  data: {
    id: TRANSFER.id,
    status: 'SENT',
    request_id: KEY,
    beneficiary: {
      bank_details: {
        account_name: 'Anna Schmidt',
        account_number: '50001121',
        iban: 'DE89370400440532013000',
      },
      address: { street_address: '412 5th Avenue' },
    },
  },
  created_at: '2026-10-03T11:59:00+0000',
  version: '2025-06-30',
};

test('a webhook is verified as HMAC-SHA256 of timestamp + raw body', () => {
  const { provider } = buildAirwallex(() => undefined);
  const { rawBody, headers } = signed(EVENT);
  assert.equal(provider.verifyWebhook(headers, rawBody), true);

  assert.equal(provider.verifyWebhook({}, rawBody), false);
  assert.equal(provider.verifyWebhook({ ...headers, 'x-signature': 'zz' }, rawBody), false);
  assert.equal(
    provider.verifyWebhook(headers, Buffer.from(rawBody.toString().replace('SENT', 'PAID'))),
    false,
  );
  assert.equal(provider.verifyWebhook({ ...headers, 'x-timestamp': '1' }, rawBody), false);
  const forged = signed(EVENT, 'another-secret');
  assert.equal(provider.verifyWebhook(forged.headers, forged.rawBody), false);
});

test('a correctly signed but stale webhook is refused (replay protection)', () => {
  const { provider } = buildAirwallex(() => undefined);
  const old = signed(EVENT, undefined, NOW.getTime() - 11 * 60 * 1000);
  assert.equal(provider.verifyWebhook(old.headers, old.rawBody), false);
  const recent = signed(EVENT, undefined, NOW.getTime() - 9 * 60 * 1000);
  assert.equal(provider.verifyWebhook(recent.headers, recent.rawBody), true);
});

test('without a configured secret no webhook is accepted', async () => {
  const { loadAirwallexConfig } =
    await import('../../../../../src/infrastructure/providers/airwallex/airwallex-config.ts');
  const { parseEnv } = await import('../../../../../src/config/env.ts');
  const { AirwallexPayoutProvider } =
    await import('../../../../../src/infrastructure/providers/airwallex/airwallex-payout-provider.ts');
  const { AIRWALLEX_WEBHOOK_SECRET: _omit, ...withoutSecret } = AWX_ENV;
  void _omit;
  const provider = new AirwallexPayoutProvider({
    config: loadAirwallexConfig(parseEnv(withoutSecret)),
    http: buildAirwallex(() => undefined).provider as never,
    clock: () => NOW,
  });
  const { rawBody, headers } = signed(EVENT, '');
  assert.equal(provider.verifyWebhook(headers, rawBody), false);
});

test('a transfer status event is normalised, and the stored payload carries no bank details', () => {
  const { provider } = buildAirwallex(() => undefined);
  const event = provider.parseWebhook(Buffer.from(JSON.stringify(EVENT)));

  assert.equal(event.type, 'transfer.status_changed');
  assert.equal(event.providerTransferId, TRANSFER.id);
  assert.equal(event.newStatus, 'SENT');
  assert.equal(event.providerStatus, 'SENT');
  assert.equal(event.eventId, EVENT.id);
  assert.equal(event.occurredAt.toISOString(), '2026-10-03T11:59:00.000Z');

  const stored = JSON.stringify(event.raw);
  for (const personal of ['Anna Schmidt', '50001121', 'DE89370400440532013000', '412 5th Avenue']) {
    assert.equal(stored.includes(personal), false, personal);
  }
  assert.deepEqual(event.raw, {
    id: EVENT.id,
    name: 'payout.transfer.sent',
    account_id: 'acct_customer_1',
    created_at: EVENT.created_at,
    data: { id: TRANSFER.id, status: 'SENT', request_id: KEY },
  });
});

test('funding, other account and malformed events are reported as unknown', () => {
  const { provider } = buildAirwallex(() => undefined);
  const parse = (body: unknown) => provider.parseWebhook(Buffer.from(JSON.stringify(body))).type;
  assert.equal(parse({ ...EVENT, name: 'payout.transfer.funding.funded' }), 'unknown');
  assert.equal(parse({ ...EVENT, name: 'account.connected' }), 'unknown');
  assert.equal(parse({ ...EVENT, name: 'account.offboarding.pending' }), 'unknown');
  assert.equal(parse({ ...EVENT, data: {} }), 'unknown');
  assert.equal(parse({ ...EVENT, created_at: 'not a date' }), 'unknown');
  assert.equal(provider.parseWebhook(Buffer.from('not json')).type, 'unknown');
});

test('connected-account status events become customer status changes, without the account details', () => {
  const { provider } = buildAirwallex(() => undefined);
  const parse = (name: string, extra: Record<string, unknown> = {}) =>
    provider.parseWebhook(
      Buffer.from(
        JSON.stringify({
          id: 'evt-acct-1',
          name,
          accountId: 'acct_123',
          created_at: '2026-10-03T10:00:00+0000',
          // The real event carries the whole account, personal details included.
          data: { accountDetails: { authorisedPersonDetails: { email: 'jane@example.test' } } },
          ...extra,
        }),
      ),
    );

  const expected: Record<string, string> = {
    'account.active': 'VERIFIED',
    'account.submitted': 'PENDING',
    'account.action_required': 'PENDING',
    'account.suspended': 'REJECTED',
    'account.dormant': 'NEEDS_RELINK',
    'account.closed': 'NEEDS_RELINK',
  };
  for (const [name, status] of Object.entries(expected)) {
    const event = parse(name);
    assert.equal(event.type, 'customer.status_changed', name);
    assert.equal(event.providerCustomerRef, 'acct_123');
    assert.equal(event.newCustomerStatus, status, name);
    assert.equal(event.eventId, 'evt-acct-1');
    assert.equal(event.occurredAt.toISOString(), '2026-10-03T10:00:00.000Z');
  }
  const raw = JSON.stringify(parse('account.active').raw);
  assert.ok(!raw.includes('jane@example.test') && !raw.includes('authorisedPerson'));
  assert.equal(parse('account.active', { accountId: undefined }).type, 'unknown');
});

// --- Errors and simulation --------------------------------------------------

test('transport-level failures are typed and flagged by whether the outcome is known', async () => {
  const outcome = async (status: number, code = '') => {
    const { provider } = buildAirwallex(() => ({ status, body: { code } }));
    try {
      await provider.cancelTransfer({ link: LINK, transfer: PAYOUT });
      return 'ok';
    } catch (error) {
      return error instanceof ProviderUnavailableError
        ? `unavailable:${error.outcomeUnknown}`
        : (error as Error).constructor.name;
    }
  };
  assert.equal(await outcome(500), 'unavailable:true');
  assert.equal(await outcome(409, 'request_pending'), 'unavailable:true');
  assert.equal(await outcome(429), 'unavailable:false');
  assert.equal(await outcome(403), 'ProviderRejectedError');
  assert.equal(await outcome(404), 'ProviderRejectedError');
});

test('a non-idempotent POST is never retried; a GET is', async () => {
  let posts = 0;
  let gets = 0;
  const { provider } = buildAirwallex((req) => {
    if (req.method === 'POST') {
      posts += 1;
      return { status: 503, body: {} };
    }
    gets += 1;
    return gets < 3 ? { status: 503, body: {} } : { status: 200, body: { status: 'ACTIVE' } };
  });
  await assert.rejects(provider.cancelTransfer({ link: LINK, transfer: PAYOUT }));
  assert.equal(posts, 1);
  assert.equal(await provider.getCustomerStatus(LINK), 'VERIFIED');
  assert.equal(gets, 3);
});

test('the sandbox simulation calls the transition endpoint, and is refused outside the sandbox', async () => {
  const { provider, apiRequests } = buildAirwallex(() => ({ status: 200, body: {} }));
  await provider.simulateTransferTransition(LINK, TRANSFER.id, 'SENT');
  assert.ok(
    apiRequests()[0]?.url.endsWith(`/api/v1/simulation/transfers/${TRANSFER.id}/transition`),
  );
  assert.deepEqual(JSON.parse(apiRequests()[0]?.body ?? '{}'), { next_status: 'SENT' });

  const production = buildAirwallex(() => ({ status: 200, body: {} }), {
    NODE_ENV: 'production',
    AIRWALLEX_BASE_URL: 'https://api.airwallex.com',
    AIRWALLEX_ALLOW_PRODUCTION: 'true',
  });
  await assert.rejects(
    production.provider.simulateTransferTransition(LINK, TRANSFER.id, 'SENT'),
    NotSupportedError,
  );
  assert.equal(production.apiRequests().length, 0);
});
