import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findTransition,
  isSettled,
  isTransferStatus,
  TERMINAL_TRANSFER_STATUSES,
  TRANSFER_STATUSES,
  TRANSFER_TRANSITIONS,
} from '../../../../src/domain/payout/transfer-status.ts';

test('the internal enum is exactly the eight agreed statuses', () => {
  assert.deepEqual(
    [...TRANSFER_STATUSES],
    [
      'DRAFT',
      'AWAITING_FUNDS',
      'PROCESSING',
      'SENT',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
      'FAILED',
    ],
  );
  assert.equal(isTransferStatus('COMPLETED'), true);
  assert.equal(isTransferStatus('completed'), false);
});

test('terminal statuses have no way out', () => {
  for (const status of TERMINAL_TRANSFER_STATUSES) {
    assert.equal(
      TRANSFER_TRANSITIONS.some((t) => t.from === status),
      false,
      `${status} must be terminal`,
    );
  }
});

test('every status that says what the provider did with the money needs provider evidence', () => {
  for (const to of ['AWAITING_FUNDS', 'PROCESSING', 'SENT', 'COMPLETED', 'REFUNDED'] as const) {
    for (const transition of TRANSFER_TRANSITIONS.filter((t) => t.to === to)) {
      assert.equal(
        transition.requiresProviderEvidence,
        true,
        `${transition.from} -> ${to} must need provider evidence`,
      );
    }
  }
});

test('every way out of FAILED needs provider evidence', () => {
  const out = TRANSFER_TRANSITIONS.filter((t) => t.from === 'FAILED');
  assert.deepEqual(out.map((t) => t.to).sort(), ['COMPLETED', 'PROCESSING', 'REFUNDED', 'SENT']);
  assert.ok(out.every((t) => t.requiresProviderEvidence));
});

test('SomPay alone may only fail or cancel a transfer', () => {
  const local = TRANSFER_TRANSITIONS.filter((t) => !t.requiresProviderEvidence);
  assert.deepEqual([...new Set(local.map((t) => t.to))].sort(), ['CANCELLED', 'FAILED']);
});

test('a missed intermediate webhook does not strand a transfer', () => {
  assert.ok(findTransition('AWAITING_FUNDS', 'COMPLETED'));
  assert.ok(findTransition('AWAITING_FUNDS', 'SENT'));
  assert.equal(findTransition('COMPLETED', 'PROCESSING'), undefined);
});

test('isSettled', () => {
  assert.equal(isSettled('COMPLETED'), true);
  assert.equal(isSettled('FAILED'), true);
  assert.equal(isSettled('CANCELLED'), true);
  assert.equal(isSettled('SENT'), false);
  assert.equal(isSettled('AWAITING_FUNDS'), false);
});
