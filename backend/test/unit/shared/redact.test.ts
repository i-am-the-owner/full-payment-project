import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPayload } from '../../../src/shared/redact.ts';

test('personal data is removed at any depth; ids, statuses and event names stay', () => {
  const redacted = redactPayload({
    id: 'evt_1',
    name: 'payout.transfer.sent',
    created_at: '2026-10-03T10:00:00Z',
    data: {
      id: 'tr_9',
      status: 'SENT',
      beneficiary: {
        first_name: 'Anna',
        iban: 'DE89370400440532013000',
        address: { city: 'Berlin' },
      },
      email: 'anna@example.test',
      list: [{ accountNumber: '12345678', amount: '10.00' }],
      profileId: 4242,
    },
  });
  assert.deepEqual(redacted, {
    id: 'evt_1',
    name: 'payout.transfer.sent',
    created_at: '2026-10-03T10:00:00Z',
    data: {
      id: 'tr_9',
      status: 'SENT',
      beneficiary: '[redacted]',
      email: '[redacted]',
      list: [{ accountNumber: '[redacted]', amount: '10.00' }],
      profileId: 4242,
    },
  });
});

test('a "name" that is a person is redacted, one that is an event type is kept', () => {
  assert.deepEqual(redactPayload({ name: 'Anna Schmidt' }), { name: '[redacted]' });
  assert.deepEqual(redactPayload({ name: 'transfers#state-change' }), {
    name: 'transfers#state-change',
  });
});

test('a hostile payload cannot bloat the stored row', () => {
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let i = 0; i < 50; i += 1) {
    cursor.next = {};
    cursor = cursor.next as Record<string, unknown>;
  }
  assert.ok(JSON.stringify(redactPayload(deep)).includes('[redacted]'));
  const wide = redactPayload(
    Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i])),
  );
  assert.equal(Object.keys(wide as object).length, 60);
  assert.equal((redactPayload('x'.repeat(5000)) as string).length, 201);
});
