import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransferStatus } from '../../../../src/domain/payout/transfer-status.ts';
import {
  mapMockStatus,
  MOCK_TRANSFER_STATUSES,
} from '../../../../src/infrastructure/providers/mock/mock-status-mapping.ts';
import {
  AIRWALLEX_TRANSFER_STATUSES,
  mapAirwallexStatus,
} from '../../../../src/infrastructure/providers/airwallex/airwallex-status-mapping.ts';
import { mapWiseStatus } from '../../../../src/infrastructure/providers/wise/wise-status-mapping.ts';
import type { WiseTransferStatus } from '../../../../src/infrastructure/providers/wise/wise-models.ts';

// These tables are the source of docs/STATUSES.md. Change both together.
const WISE: [WiseTransferStatus, string | null][] = [
  ['incoming_payment_waiting', 'AWAITING_FUNDS'],
  ['incoming_payment_initiated', 'PROCESSING'],
  ['processing', 'PROCESSING'],
  ['funds_converted', 'PROCESSING'],
  ['outgoing_payment_sent', 'SENT'],
  ['bounced_back', 'FAILED'],
  ['charged_back', 'FAILED'],
  ['cancelled', 'CANCELLED'],
  ['funds_refunded', 'REFUNDED'],
  ['unknown', null],
];

const MOCK: [string, string | null][] = [
  ['pending_funding', 'AWAITING_FUNDS'],
  ['funded', 'PROCESSING'],
  ['paid_out', 'SENT'],
  ['delivered', 'COMPLETED'],
  ['cancelled', 'CANCELLED'],
  ['returned', 'REFUNDED'],
  ['rejected', 'FAILED'],
];

test('every Wise transfer state maps to the documented internal status', () => {
  for (const [wise, expected] of WISE) {
    assert.equal(mapWiseStatus(wise), expected, wise);
  }
});

test('Wise has no delivered state: its last success state is SENT, never COMPLETED', () => {
  assert.equal(
    WISE.some(([, internal]) => internal === 'COMPLETED'),
    false,
  );
});

test('every mock status maps to the documented internal status', () => {
  assert.deepEqual([...MOCK_TRANSFER_STATUSES].sort(), MOCK.map(([status]) => status).sort());
  for (const [mock, expected] of MOCK) {
    assert.equal(mapMockStatus(mock), expected, mock);
  }
});

test('an unrecognised provider status maps to null, never to a guess', () => {
  assert.equal(mapMockStatus('something_new'), null);
});

test('mappings only ever produce statuses from the internal enum', () => {
  for (const [, internal] of [...WISE, ...MOCK]) {
    assert.ok(internal === null || isTransferStatus(internal));
  }
});

test('the mock can reach all eight internal statuses except DRAFT', () => {
  const reachable = new Set(MOCK.map(([, internal]) => internal));
  for (const status of [
    'AWAITING_FUNDS',
    'PROCESSING',
    'SENT',
    'COMPLETED',
    'CANCELLED',
    'REFUNDED',
    'FAILED',
  ]) {
    assert.ok(reachable.has(status), status);
  }
});

const AIRWALLEX: [string, string][] = [
  ['IN_APPROVAL', 'AWAITING_FUNDS'],
  ['APPROVAL_RECALLED', 'AWAITING_FUNDS'],
  ['APPROVAL_REJECTED', 'AWAITING_FUNDS'],
  ['APPROVAL_BLOCKED', 'AWAITING_FUNDS'],
  ['SCHEDULED', 'AWAITING_FUNDS'],
  ['OVERDUE', 'AWAITING_FUNDS'],
  ['PROCESSING', 'PROCESSING'],
  ['SENT', 'SENT'],
  ['PAID', 'COMPLETED'],
  ['FAILED', 'FAILED'],
  ['CANCELLED', 'CANCELLED'],
];

test('every Airwallex transfer status maps to the documented internal status', () => {
  assert.deepEqual(
    [...AIRWALLEX_TRANSFER_STATUSES].sort(),
    AIRWALLEX.map(([status]) => status).sort(),
  );
  for (const [airwallex, expected] of AIRWALLEX) {
    assert.equal(mapAirwallexStatus(airwallex), expected, airwallex);
    assert.ok(isTransferStatus(expected));
  }
  assert.equal(mapAirwallexStatus('READY_FOR_DISPATCH'), null);
});
