import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { WiseApiClient } from '../../../../../src/infrastructure/providers/wise/wise-api-client.ts';
import { WiseHttpClient } from '../../../../../src/infrastructure/providers/wise/wise-http-client.ts';
import { WiseScaSigner } from '../../../../../src/infrastructure/providers/wise/wise-sca-signer.ts';
import { WiseError } from '../../../../../src/infrastructure/providers/wise/wise-errors.ts';
import { createLogger } from '../../../../../src/shared/logger.ts';
import {
  handlerTransport,
  RecordingAuditLog,
  silentWiseLogger,
  wiseFixture,
  type FakeResponseSpec,
  type RecordedRequest,
} from '../../../../support/wise-fakes.ts';

const PROFILE = '555';

const EXPONENTS: Record<string, number> = { GBP: 2, KES: 2, JPY: 0, KWD: 3 };
function minorUnits(currency: string): number {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) {
    throw new Error(`Unknown currency "${currency}"`);
  }
  return exponent;
}

function build(route: (req: RecordedRequest) => FakeResponseSpec, options: { sca?: boolean } = {}) {
  const { transport, requests } = handlerTransport(route);
  const auditLog = new RecordingAuditLog();
  const http = new WiseHttpClient({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    timeoutMs: 5_000,
    maxRetries: 2,
    getAuthToken: () => Promise.resolve('token'),
    invalidateAuthToken: () => {},
    logger: silentWiseLogger,
    transport,
    sleep: () => Promise.resolve(),
  });
  const scaSigner = options.sca
    ? new WiseScaSigner(
        generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }).privateKey,
      )
    : undefined;
  const client = new WiseApiClient({
    http,
    profileId: PROFILE,
    isSandbox: true,
    auditLog,
    currencyMinorUnits: minorUnits,
    ...(scaSigner ? { scaSigner } : {}),
  });
  return { client, requests, auditLog };
}

test('createQuote sends a v3 profile quote and normalises the response to minor units', async () => {
  const { client, requests } = build((req) => {
    assert.equal(req.method, 'POST');
    assert.ok(req.url.endsWith(`/v3/profiles/${PROFILE}/quotes`));
    assert.deepEqual(JSON.parse(req.body ?? '{}'), {
      sourceCurrency: 'GBP',
      targetCurrency: 'KES',
      sourceAmount: 100,
      payOut: 'BANK_TRANSFER',
    });
    return { status: 200, body: wiseFixture('quote.json') };
  });

  const quote = await client.createQuote({
    sourceCurrency: 'GBP',
    targetCurrency: 'KES',
    sourceAmountMinor: 10_000n,
    payOut: 'BANK_TRANSFER',
  });

  assert.equal(quote.id, '11144c35-9fe8-4c32-b7fd-d05c2a7734bf');
  assert.equal(quote.source.amountMinor, 10_000n);
  assert.equal(quote.target.amountMinor, 1_722_550n);
  assert.equal(quote.rate, '174.5');
  assert.equal(quote.wiseFee.amountMinor, 77n); // fee.total 0.77 GBP -> the enabled option
  assert.equal(quote.payOut, 'BANK_TRANSFER');
  assert.equal(requests.length, 1);
});

test('createRecipientBankAccount maps a GBP sort-code account', async () => {
  const { client } = build((req) => {
    assert.ok(req.url.endsWith('/v1/accounts'));
    const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
    assert.equal(body.type, 'sort_code');
    assert.equal(body.profile, 555);
    assert.deepEqual(body.details, {
      legalType: 'PRIVATE',
      sortCode: '231470',
      accountNumber: '28821822',
    });
    return {
      status: 200,
      body: {
        ...wiseFixture<Record<string, unknown>>('recipient.json'),
        currency: 'GBP',
        type: 'sort_code',
      },
    };
  });

  const recipient = await client.createRecipientBankAccount({
    currency: 'GBP',
    accountHolderName: 'Amina Otieno',
    legalType: 'PRIVATE',
    sortCode: '231470',
    accountNumber: '28821822',
  });
  assert.equal(recipient.id, '40000001');
  assert.equal(recipient.type, 'sort_code');
});

test('createTransfer forwards the idempotency key as customerTransactionId and audits it', async () => {
  const { client, requests, auditLog } = build((req) => {
    assert.ok(req.url.endsWith('/v1/transfers'));
    const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
    assert.equal(body.customerTransactionId, 'idem-key-42');
    assert.equal(body.quoteUuid, '11144c35-9fe8-4c32-b7fd-d05c2a7734bf');
    assert.equal(body.targetAccount, 40000001);
    return { status: 200, body: wiseFixture('transfer-created.json') };
  });

  const transfer = await client.createTransfer({
    quoteId: '11144c35-9fe8-4c32-b7fd-d05c2a7734bf',
    targetAccountId: '40000001',
    idempotencyKey: 'idem-key-42',
    reference: 'ALM-7F3A2B',
  });

  assert.equal(transfer.id, '51000009');
  assert.equal(transfer.status, 'incoming_payment_waiting');
  assert.equal(transfer.source?.amountMinor, 10_077n);
  assert.ok(auditLog.actions().includes('wise.transfer.created'));
  const context = auditLog.entries[0]?.context ?? {};
  assert.equal(
    JSON.stringify(context).includes('01001234567800'),
    false,
    'no account numbers in audit',
  );
  // The transfer create is retryable at the HTTP layer (idempotent).
  assert.equal(requests.length, 1);
});

test('a transfer create that transiently fails is retried and does not double up', async () => {
  let calls = 0;
  const { client } = build(() => {
    calls += 1;
    return calls === 1
      ? { status: 502 }
      : { status: 200, body: wiseFixture('transfer-created.json') };
  });
  const transfer = await client.createTransfer({
    quoteId: 'q',
    targetAccountId: '40000001',
    idempotencyKey: 'idem-1',
  });
  assert.equal(calls, 2);
  assert.equal(transfer.id, '51000009');
});

test('getTransfer maps the Wise status', async () => {
  const { client } = build(() => ({
    status: 200,
    body: {
      ...wiseFixture<Record<string, unknown>>('transfer-created.json'),
      status: 'outgoing_payment_sent',
    },
  }));
  const transfer = await client.getTransfer('51000009');
  assert.equal(transfer.status, 'outgoing_payment_sent');
});

test('fundTransferFromBalance handles an SCA challenge by signing and retrying', async () => {
  let attempt = 0;
  const { client, requests, auditLog } = build(
    (req) => {
      attempt += 1;
      if (attempt === 1) {
        assert.equal(req.headers['x-2fa-approval'], undefined);
        return { status: 403, headers: { 'x-2fa-approval': 'ott-xyz' }, body: {} };
      }
      assert.equal(req.headers['x-2fa-approval'], 'ott-xyz');
      assert.ok(req.headers['X-Signature'] && req.headers['X-Signature'].length > 20);
      return { status: 200, body: { type: 'BALANCE', status: 'COMPLETED' } };
    },
    { sca: true },
  );

  const result = await client.fundTransferFromBalance('51000009');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(requests.length, 2);
  assert.ok(auditLog.actions().includes('wise.transfer.funded'));
});

test('fundTransferFromBalance surfaces a clear error when SCA is required but no key is configured', async () => {
  const { client } = build(() => ({ status: 403, headers: { 'x-2fa-approval': 'ott' }, body: {} }));
  await assert.rejects(client.fundTransferFromBalance('51000009'), (e) => {
    assert.ok(e instanceof WiseError);
    assert.equal(e.code, 'wise_sca_required');
    return true;
  });
});

test('cancelTransfer PUTs to the cancel path and audits', async () => {
  const { client, requests, auditLog } = build((req) => {
    assert.equal(req.method, 'PUT');
    assert.ok(req.url.endsWith('/v1/transfers/51000009/cancel'));
    return {
      status: 200,
      body: {
        ...wiseFixture<Record<string, unknown>>('transfer-created.json'),
        status: 'cancelled',
      },
    };
  });
  const transfer = await client.cancelTransfer('51000009');
  assert.equal(transfer.status, 'cancelled');
  assert.equal(requests[0]?.method, 'PUT');
  assert.ok(auditLog.actions().includes('wise.transfer.cancelled'));
});

test('simulateTransferTransition refuses to run outside the sandbox', async () => {
  const { transport } = handlerTransport(() => ({ status: 200, body: {} }));
  const client = new WiseApiClient({
    http: new WiseHttpClient({
      baseUrl: 'https://api.transferwise.com',
      timeoutMs: 1000,
      maxRetries: 0,
      getAuthToken: () => Promise.resolve('t'),
      invalidateAuthToken: () => {},
      logger: silentWiseLogger,
      transport,
      sleep: () => Promise.resolve(),
    }),
    profileId: PROFILE,
    isSandbox: false,
    auditLog: new RecordingAuditLog(),
    currencyMinorUnits: minorUnits,
  });
  await assert.rejects(client.simulateTransferTransition('1', 'processing'), /sandbox/);
});

test('validation errors from Wise propagate as WiseError, not raw', async () => {
  const { client } = build(() => ({ status: 422, body: wiseFixture('error-validation.json') }));
  await assert.rejects(
    client.createRecipientBankAccount({
      currency: 'GBP',
      accountHolderName: 'x',
      legalType: 'PRIVATE',
      sortCode: 'bad',
      accountNumber: '1',
    }),
    (e) => {
      assert.ok(e instanceof WiseError);
      assert.equal(e.code, 'wise_validation');
      return true;
    },
  );
});

test('a full quote → recipient → transfer → fund sequence never logs or audits sensitive data', async () => {
  const logLines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (_l, line) => logLines.push(line) });
  const auditLog = new RecordingAuditLog();

  const { transport } = handlerTransport((req) => {
    if (req.url.includes('/quotes')) return { status: 200, body: wiseFixture('quote.json') };
    if (req.url.endsWith('/v1/accounts')) {
      return { status: 200, body: wiseFixture('recipient.json') };
    }
    if (req.url.endsWith('/v1/transfers')) {
      return { status: 200, body: wiseFixture('transfer-created.json') };
    }
    if (req.url.includes('/payments'))
      return { status: 200, body: { type: 'BALANCE', status: 'COMPLETED' } };
    return { status: 404, body: {} };
  });

  const client = new WiseApiClient({
    http: new WiseHttpClient({
      baseUrl: 'https://api.sandbox.transferwise.tech',
      timeoutMs: 5_000,
      maxRetries: 0,
      getAuthToken: () => Promise.resolve('BEARER-SECRET-TOKEN-9f8e7d'),
      invalidateAuthToken: () => {},
      logger,
      transport,
      sleep: () => Promise.resolve(),
    }),
    profileId: PROFILE,
    isSandbox: true,
    auditLog,
    currencyMinorUnits: minorUnits,
  });

  await client.createQuote({
    sourceCurrency: 'GBP',
    targetCurrency: 'KES',
    sourceAmountMinor: 10_000n,
  });
  await client.createRecipientBankAccount({
    currency: 'GBP',
    accountHolderName: 'Amina Otieno',
    legalType: 'PRIVATE',
    sortCode: '231470',
    accountNumber: '28821822',
  });
  await client.createTransfer({
    quoteId: 'q',
    targetAccountId: '40000001',
    idempotencyKey: 'idem-9',
  });
  await client.fundTransferFromBalance('51000009');

  const haystack = [logLines.join('\n'), JSON.stringify(auditLog.entries)].join('\n');
  for (const secret of [
    'BEARER-SECRET-TOKEN-9f8e7d',
    '231470', // sort code
    '28821822', // account number
    '01001234567800', // recipient account number from the fixture
    'Amina Otieno', // account holder name
  ]) {
    assert.doesNotMatch(haystack, new RegExp(secret), `leaked: ${secret}`);
  }
});

test("amounts use each currency's own minor-unit exponent (not a default of 2)", async () => {
  const { client } = build((req) => {
    // 5,000 JPY is 5000 minor units (exponent 0), sent as 5000 – not 50.
    assert.equal((JSON.parse(req.body ?? '{}') as { sourceAmount: number }).sourceAmount, 5000);
    return {
      status: 200,
      body: {
        id: 'q-jpy',
        sourceCurrency: 'JPY',
        targetCurrency: 'KWD',
        rate: 0.00205,
        paymentOptions: [{ payOut: 'BANK_TRANSFER', sourceAmount: 5000, targetAmount: 10.25 }],
      },
    };
  });

  const quote = await client.createQuote({
    sourceCurrency: 'JPY',
    targetCurrency: 'KWD',
    sourceAmountMinor: 5000n,
    payOut: 'BANK_TRANSFER',
  });
  assert.equal(quote.source.amountMinor, 5000n);
  assert.equal(quote.target.amountMinor, 10_250n); // 10.250 KWD, exponent 3
});

test('an unknown currency is refused rather than assumed to have 2 decimals', async () => {
  const { client, requests } = build(() => ({ status: 200, body: {} }));
  await assert.rejects(
    client.createQuote({ sourceCurrency: 'XXX', targetCurrency: 'KES', sourceAmountMinor: 100n }),
    /Unknown currency/,
  );
  assert.equal(requests.length, 0);
});
