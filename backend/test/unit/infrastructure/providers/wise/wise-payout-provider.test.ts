import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import {
  DuplicateError,
  ProviderRejectedError,
  ProviderUnavailableError,
  ScaRequiredError,
  ValidationFailedError,
} from '../../../../../src/domain/payout/errors.ts';
import {
  WiseError,
  WiseTimeoutError,
} from '../../../../../src/infrastructure/providers/wise/wise-errors.ts';
import { WiseApiClient } from '../../../../../src/infrastructure/providers/wise/wise-api-client.ts';
import { WiseHttpClient } from '../../../../../src/infrastructure/providers/wise/wise-http-client.ts';
import {
  toPayoutError,
  WisePayoutProvider,
} from '../../../../../src/infrastructure/providers/wise/wise-payout-provider.ts';
import { RsaWiseWebhookVerifier } from '../../../../../src/infrastructure/providers/wise/wise-webhook-verifier.ts';
import {
  handlerTransport,
  RecordingAuditLog,
  silentWiseLogger,
  wiseFixture,
  type FakeResponseSpec,
  type RecordedRequest,
} from '../../../../support/wise-fakes.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function build(route: (req: RecordedRequest) => FakeResponseSpec) {
  const { transport, requests } = handlerTransport(route);
  const http = new WiseHttpClient({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    timeoutMs: 5_000,
    maxRetries: 0,
    getAuthToken: () => Promise.resolve('token'),
    invalidateAuthToken: () => {},
    logger: silentWiseLogger,
    transport,
  });
  const provider = new WisePayoutProvider({
    clientFor: (profileId) =>
      new WiseApiClient({
        http,
        profileId,
        isSandbox: true,
        auditLog: new RecordingAuditLog(),
        currencyMinorUnits: () => 2,
      }),
    webhookVerifier: new RsaWiseWebhookVerifier(publicKey),
  });
  return { provider, requests };
}

const LINK = { provider: 'wise' as const, customerRef: '777001' };

test('every call is made for the customer’s own Wise profile, never a shared one', async () => {
  const { provider, requests } = build(() => ({ status: 200, body: wiseFixture('quote.json') }));
  const quote = await provider.createQuote({
    link: LINK,
    sourceCurrency: 'GBP',
    targetCurrency: 'KES',
    sourceAmountMinor: 10_000n,
  });

  assert.ok(requests[0]?.url.endsWith('/v3/profiles/777001/quotes'));
  // Our own types come back – not Wise's response shape.
  assert.deepEqual(Object.keys(quote).sort(), [
    'estimatedDelivery',
    'expiresAt',
    'fee',
    'id',
    'rate',
    'sourceAmount',
    'targetAmount',
  ]);
  assert.deepEqual(quote.sourceAmount, { currency: 'GBP', amountMinor: 10_000n });
  assert.deepEqual(quote.fee, { currency: 'GBP', amountMinor: 77n });
});

test('a created transfer comes back with the mapped internal status', async () => {
  const { provider } = build(() => ({ status: 200, body: wiseFixture('transfer-created.json') }));
  const transfer = await provider.createTransfer({
    link: LINK,
    quote: {
      id: 'q-1',
      rate: '1',
      fee: { currency: 'GBP', amountMinor: 0n },
      sourceAmount: { currency: 'GBP', amountMinor: 1n },
      targetAmount: { currency: 'KES', amountMinor: 1n },
      expiresAt: new Date(),
      estimatedDelivery: undefined,
    },
    recipient: {
      id: '40000000',
      name: 'A',
      currency: 'KES',
      country: 'KE',
      accountSummary: '••••',
    },
    answers: {},
    idempotencyKey: '5a1e0b0e-0000-4000-8000-000000000001',
    reference: 'ALM-1',
  });
  assert.equal(transfer.status, 'AWAITING_FUNDS');
  assert.equal(transfer.providerStatus, 'incoming_payment_waiting');
});

test('Wise failures are translated into the typed payout errors', () => {
  const validation = toPayoutError(
    new WiseError('wise_validation', 'bad', {
      details: [{ code: 'IBAN', message: 'Invalid IBAN' }],
    }),
  );
  assert.ok(validation instanceof ValidationFailedError);
  assert.deepEqual(validation.fieldErrors, [{ field: 'IBAN', message: 'Invalid IBAN' }]);

  assert.ok(toPayoutError(new WiseError('wise_conflict', 'x')) instanceof DuplicateError);
  assert.ok(toPayoutError(new WiseError('wise_forbidden', 'x')) instanceof ProviderRejectedError);
  assert.ok(toPayoutError(new WiseError('wise_sca_required', 'x')) instanceof ScaRequiredError);

  const plain = new Error('not a wise error');
  assert.equal(toPayoutError(plain), plain);
});

test('only "no usable answer" failures are flagged as outcome unknown', () => {
  const unknown = (error: WiseError): boolean => {
    const mapped = toPayoutError(error);
    assert.ok(mapped instanceof ProviderUnavailableError);
    assert.equal(mapped.retryable, true);
    return mapped.outcomeUnknown;
  };
  assert.equal(unknown(new WiseTimeoutError()), true);
  assert.equal(unknown(new WiseError('wise_unavailable', 'x')), true);
  assert.equal(unknown(new WiseError('wise_unexpected', 'x')), true);
  // Refused before processing: nothing can have happened.
  assert.equal(unknown(new WiseError('wise_rate_limited', 'x')), false);
  assert.equal(unknown(new WiseError('wise_auth', 'x')), false);
});

test('a provider 5xx on transfer creation surfaces as outcome-unknown ProviderUnavailable', async () => {
  const { provider } = build(() => ({ status: 503, body: { message: 'down' } }));
  await assert.rejects(
    provider.getTransfer({ link: LINK, transferRef: '1' }),
    (error: unknown) => error instanceof ProviderUnavailableError && error.outcomeUnknown,
  );
});

test('webhooks are verified by RSA signature and parsed into a normalised event', () => {
  const { provider } = build(() => ({ status: 200, body: {} }));
  const rawBody = Buffer.from(JSON.stringify(wiseFixture('webhook-state-change.json')));
  const signature = createSign('RSA-SHA256').update(rawBody).sign(privateKey, 'base64');

  assert.equal(provider.verifyWebhook({ 'x-signature-sha256': signature }, rawBody), true);
  assert.equal(provider.verifyWebhook({}, rawBody), false);
  assert.equal(
    provider.verifyWebhook({ 'x-signature-sha256': signature }, Buffer.from('{}')),
    false,
  );

  const event = provider.parseWebhook(rawBody);
  assert.equal(event.type, 'transfer.status_changed');
  assert.ok(event.providerTransferId);
  assert.ok(event.newStatus);
  assert.equal(
    provider.parseWebhook(Buffer.from('{"event_type":"balances#credit"}')).type,
    'unknown',
  );
  assert.equal(provider.parseWebhook(Buffer.from('nonsense')).type, 'unknown');
});
