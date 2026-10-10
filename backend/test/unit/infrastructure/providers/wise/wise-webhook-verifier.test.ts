import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { RsaWiseWebhookVerifier } from '../../../../../src/infrastructure/providers/wise/wise-webhook-verifier.ts';
import { wiseFixture } from '../../../../support/wise-fakes.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function sign(body: Buffer): string {
  return createSign('RSA-SHA256').update(body).sign(privateKey, 'base64');
}

const verifier = new RsaWiseWebhookVerifier(publicKey);
const eventBody = Buffer.from(JSON.stringify(wiseFixture('webhook-state-change.json')));

test('accepts a body signed with the matching key', () => {
  assert.equal(verifier.isValidSignature(eventBody, sign(eventBody)), true);
});

test('rejects a tampered body', () => {
  const signature = sign(eventBody);
  const tampered = Buffer.from(eventBody.toString().replace('outgoing_payment_sent', 'cancelled'));
  assert.equal(verifier.isValidSignature(tampered, signature), false);
});

test('rejects a missing, empty or non-base64 signature header', () => {
  assert.equal(verifier.isValidSignature(eventBody, undefined), false);
  assert.equal(verifier.isValidSignature(eventBody, ''), false);
  assert.equal(verifier.isValidSignature(eventBody, '!!!not base64!!!'), false);
});

test('rejects a signature made with a different key', () => {
  const other = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const foreign = createSign('RSA-SHA256').update(eventBody).sign(other.privateKey, 'base64');
  assert.equal(verifier.isValidSignature(eventBody, foreign), false);
});

test('parses a transfers#state-change event into a domain event', () => {
  const event = verifier.parseTransferStateChange(eventBody, {
    deliveryId: 'del-1',
    isTest: false,
  });
  assert.equal(event.eventType, 'transfers#state-change');
  assert.equal(event.transferId, '51000009');
  assert.equal(event.currentStatus, 'outgoing_payment_sent');
  assert.equal(event.previousStatus, 'funds_converted');
  assert.equal(event.deliveryId, 'del-1');
  assert.equal(event.schemaVersion, '2.0.0');
  assert.equal(event.occurredAt.toISOString(), '2026-09-08T14:34:56.000Z');
});

test('maps an unknown Wise state to "unknown" rather than inventing one', () => {
  const body = Buffer.from(
    JSON.stringify({
      data: {
        resource: { id: 1 },
        current_state: 'brand_new_state',
        occurred_at: '2026-09-08T00:00:00Z',
      },
      subscription_id: 's',
      event_type: 'transfers#state-change',
      schema_version: '2.0.0',
    }),
  );
  assert.equal(verifier.parseTransferStateChange(body, {}).currentStatus, 'unknown');
});

test('rejects a non state-change event', () => {
  const body = Buffer.from(JSON.stringify({ event_type: 'balances#credit', data: {} }));
  assert.throws(() => verifier.parseTransferStateChange(body, {}), /Unsupported/);
});
