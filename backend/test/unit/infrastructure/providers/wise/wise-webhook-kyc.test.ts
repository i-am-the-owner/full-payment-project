import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { WiseApiClient } from '../../../../../src/infrastructure/providers/wise/wise-api-client.ts';
import { WiseHttpClient } from '../../../../../src/infrastructure/providers/wise/wise-http-client.ts';
import { WisePayoutProvider } from '../../../../../src/infrastructure/providers/wise/wise-payout-provider.ts';
import { mapWiseKycState } from '../../../../../src/infrastructure/providers/wise/wise-status-mapping.ts';
import { RsaWiseWebhookVerifier } from '../../../../../src/infrastructure/providers/wise/wise-webhook-verifier.ts';
import {
  handlerTransport,
  RecordingAuditLog,
  silentWiseLogger,
} from '../../../../support/wise-fakes.ts';

const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function provider(simulated: string[] = []): WisePayoutProvider {
  const { transport } = handlerTransport((request) => {
    simulated.push(request.url);
    return { status: 200, body: { id: 1, status: 'processing' } };
  });
  const http = new WiseHttpClient({
    baseUrl: 'https://api.sandbox.transferwise.tech',
    timeoutMs: 5_000,
    maxRetries: 0,
    getAuthToken: () => Promise.resolve('token'),
    invalidateAuthToken: () => {},
    logger: silentWiseLogger,
    transport,
  });
  return new WisePayoutProvider({
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
}

const KYC = (state: string) =>
  Buffer.from(
    JSON.stringify({
      schema_version: '5.0.0',
      subscription_id: 'sub-1',
      event_type: 'kyc-reviews#state-change',
      sent_at: '2026-09-03T16:29:42.123Z',
      data: {
        resource: {
          id: '46e1a5c4-4a9b-4563-39d3-18174d3ac0f8',
          state,
          prevState: 'WAITING_CUSTOMER_INPUT',
          profileId: 22016766,
          updatedAt: '2026-09-03T16:29:41.148Z',
          requirements: [
            [{ key: 'ID_DOCUMENT', state: 'NOT_PROVIDED', attributes: { name: 'Jane Doe' } }],
          ],
        },
      },
    }),
  );

test('Wise only maps the KYC review states it documents', () => {
  assert.equal(mapWiseKycState('PASSED'), 'VERIFIED');
  assert.equal(mapWiseKycState('WAITING_CUSTOMER_INPUT'), 'PENDING');
  for (const other of ['IN_REVIEW', 'REJECTED', 'passed', '']) {
    assert.equal(mapWiseKycState(other), null, other);
  }
});

test('a kyc-reviews#state-change webhook becomes a customer status change for that profile', () => {
  const event = provider().parseWebhook(KYC('PASSED'));
  assert.equal(event.type, 'customer.status_changed');
  assert.equal(event.providerCustomerRef, '22016766');
  assert.equal(event.newCustomerStatus, 'VERIFIED');
  assert.equal(event.providerStatus, 'PASSED');
  assert.equal(event.occurredAt.toISOString(), '2026-09-03T16:29:41.148Z');
  // Requirement details (which can hold personal data) are not kept.
  assert.ok(!JSON.stringify(event.raw).includes('Jane Doe'));
  assert.ok(!JSON.stringify(event.raw).includes('requirements'));

  assert.equal(provider().parseWebhook(KYC('SOMETHING_NEW')).newCustomerStatus, null);
  assert.equal(
    provider().parseWebhook(Buffer.from('{"event_type":"kyc-reviews#state-change","data":{}}'))
      .type,
    'unknown',
  );
});

test('the sandbox simulation calls the documented simulation endpoint for the customer profile', async () => {
  const urls: string[] = [];
  const state = await provider(urls).simulateTransferState(
    { provider: 'wise', customerRef: '777001' },
    '12345',
    'outgoing_payment_sent',
  );
  assert.equal(state.id.length > 0, true);
  assert.ok(urls[0]?.endsWith('/v1/simulation/transfers/12345/outgoing_payment_sent'));
});
