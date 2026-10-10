import test from 'node:test';
import assert from 'node:assert/strict';
import { MockPayoutProvider } from '../../../src/infrastructure/providers/mock/mock-payout-provider.ts';
import { customerWebhook, transferWebhook } from '../../../scripts/send-mock-webhook.ts';
import { webhookUrl, wiseSubscriptionRequests } from '../../../scripts/setup-webhooks.ts';

const SECRET = 'dev-only-secret-0123456789';

test('the dev script signs webhooks the way the mock provider verifies them', () => {
  const mock = new MockPayoutProvider({ webhookSecret: SECRET });
  const sent = transferWebhook(SECRET, {
    providerTransferId: 'mock-transfer-1',
    status: 'funded',
    occurredAt: new Date('2026-10-03T10:00:00Z'),
  });
  const headers = { 'x-mock-signature': sent.headers['x-mock-signature'] };
  assert.equal(mock.verifyWebhook(headers, Buffer.from(sent.body)), true);
  const event = mock.parseWebhook(Buffer.from(sent.body));
  assert.equal(event.type, 'transfer.status_changed');
  assert.equal(event.newStatus, 'PROCESSING');

  const customer = customerWebhook(SECRET, {
    customerRef: 'mock-pending-u1',
    status: 'verified',
    occurredAt: new Date(),
  });
  const parsed = mock.parseWebhook(Buffer.from(customer.body));
  assert.equal(parsed.type, 'customer.status_changed');
  assert.equal(parsed.newCustomerStatus, 'VERIFIED');

  // A wrong secret is rejected.
  const forged = transferWebhook('another-secret-0123456789', {
    providerTransferId: 'mock-transfer-1',
    status: 'funded',
    occurredAt: new Date(),
  });
  assert.equal(
    mock.verifyWebhook(
      { 'x-mock-signature': forged.headers['x-mock-signature'] },
      Buffer.from(forged.body),
    ),
    false,
  );
});

test('the webhook URL given to a provider must be one the provider accepts', () => {
  assert.equal(
    webhookUrl('https://api.almapay.example', 'wise'),
    'https://api.almapay.example/webhooks/wise',
  );
  assert.equal(
    webhookUrl('https://api.almapay.example/', 'airwallex'),
    'https://api.almapay.example/webhooks/airwallex',
  );
  for (const bad of [
    undefined,
    'not a url',
    'http://api.almapay.example',
    'https://api.almapay.example:8443',
    'https://api.almapay.example?x=1',
    'https://user:pw@api.almapay.example',
    'https://203.0.113.9',
  ]) {
    assert.throws(() => webhookUrl(bad, 'wise'), /WEBHOOK_BASE_URL/, String(bad));
  }
});

test('Wise subscriptions cover the events SomPay handles, with the schema versions that carry millisecond times', () => {
  const requests = wiseSubscriptionRequests(
    'client key/1',
    'https://api.almapay.example/webhooks/wise',
  );
  assert.deepEqual(
    requests.map((r) => [r.body.trigger_on, (r.body.delivery as { version: string }).version]),
    [
      ['transfers#state-change', '4.0.0'],
      ['kyc-reviews#state-change', '5.0.0'],
    ],
  );
  assert.equal(requests[0]?.path, '/2026Q4/applications/client%20key%2F1/subscriptions');
  assert.equal(
    (requests[0]?.body.delivery as { url: string }).url,
    'https://api.almapay.example/webhooks/wise',
  );
});
