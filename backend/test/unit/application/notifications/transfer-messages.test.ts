import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeTransferNotice,
  notificationKindFor,
  type NotificationKind,
} from '../../../../src/application/notifications/transfer-messages.ts';

const FACTS = {
  youPaid: '100.00 GBP',
  recipientGets: '115.94 EUR',
  recipientName: 'Anna Schmidt',
  providerName: 'Wise',
  reference: 'ALM-ABC123',
  supportEmail: 'support@almapay.example',
};
const KINDS: NotificationKind[] = [
  'FUNDS_RECEIVED',
  'SENT',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
];

test('which status changes call for a message', () => {
  assert.equal(notificationKindFor('AWAITING_FUNDS', 'PROCESSING'), 'FUNDS_RECEIVED');
  assert.equal(notificationKindFor('DRAFT', 'PROCESSING'), 'FUNDS_RECEIVED');
  assert.equal(notificationKindFor('PROCESSING', 'SENT'), 'SENT');
  assert.equal(notificationKindFor('SENT', 'COMPLETED'), 'DELIVERED');
  assert.equal(notificationKindFor('AWAITING_FUNDS', 'COMPLETED'), 'DELIVERED');
  assert.equal(notificationKindFor('PROCESSING', 'CANCELLED'), 'CANCELLED');
  assert.equal(notificationKindFor('SENT', 'REFUNDED'), 'REFUNDED');
  assert.equal(notificationKindFor('FAILED', 'REFUNDED'), 'REFUNDED');
  assert.equal(notificationKindFor('SENT', 'FAILED'), 'FAILED');
  // Not announced: the transfer being created, and a recovery from FAILED.
  assert.equal(notificationKindFor('DRAFT', 'AWAITING_FUNDS'), null);
  assert.equal(notificationKindFor('FAILED', 'PROCESSING'), null);
});

test('every message names the recipient, quotes the amount and carries the reference', () => {
  for (const kind of KINDS) {
    const notice = composeTransferNotice({ ...FACTS, kind });
    const text = `${notice.subject}\n${notice.text}`;
    assert.ok(text.includes('Anna Schmidt'), `${kind}: recipient`);
    assert.ok(text.includes('100.00 GBP') || text.includes('115.94 EUR'), `${kind}: amount`);
    assert.ok(notice.text.includes('ALM-ABC123'), `${kind}: reference`);
    assert.ok(notice.subject.length < 80, `${kind}: short subject`);
    // Plain English: no provider status words or jargon.
    assert.doesNotMatch(text, /AWAITING_FUNDS|PROCESSING|webhook|idempotenc|status code/i);
  }
});

test('the failure message says the money is not lost and what happens next', () => {
  const { text } = composeTransferNotice({ ...FACTS, kind: 'FAILED' });
  assert.match(text, /Your money is not lost/);
  assert.match(text, /Wise will return your 100\.00 GBP to you/);
  assert.match(text, /do not need to do anything/);
  assert.match(text, /support@almapay\.example/);
});
