/**
 * SomPay's single internal transfer lifecycle. Every payout provider's own
 * statuses are mapped onto this enum inside that provider's adapter; nothing
 * outside `infrastructure/providers/` ever sees a provider status vocabulary.
 * The mapping tables are documented in docs/STATUSES.md.
 *
 *   DRAFT           – our record exists; the provider has not confirmed a transfer
 *   AWAITING_FUNDS  – the provider created the transfer and is waiting to be paid
 *   PROCESSING      – the provider has the funds and is executing the payout
 *   SENT            – the provider has paid out; the money is on its way
 *   COMPLETED       – the provider confirmed delivery to the recipient
 *   CANCELLED       – cancelled before it was funded
 *   REFUNDED        – the money went back to the sender
 *   FAILED          – rejected, bounced back or charged back
 */
export const TRANSFER_STATUSES = [
  'DRAFT',
  'AWAITING_FUNDS',
  'PROCESSING',
  'SENT',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export function isTransferStatus(value: unknown): value is TransferStatus {
  return typeof value === 'string' && (TRANSFER_STATUSES as readonly string[]).includes(value);
}

/** Statuses a transfer can never leave. */
export const TERMINAL_TRANSFER_STATUSES: readonly TransferStatus[] = ['CANCELLED', 'REFUNDED'];

/**
 * Statuses SomPay may set on its own authority: a definitive rejection or a
 * customer cancellation. Every other status is a statement about what the
 * provider did with the money and needs provider evidence.
 */
export type LocalTransferStatus = 'FAILED' | 'CANCELLED';

export interface TransferTransition {
  readonly from: TransferStatus;
  readonly to: TransferStatus;
  /**
   * True when only verified provider data (a signed webhook, a provider lookup
   * or a provider API response) may make this transition. Enforced by the
   * database trigger as well as by the types – see migration 0014.
   */
  readonly requiresProviderEvidence: boolean;
}

const provider = (from: TransferStatus, to: TransferStatus): TransferTransition => ({
  from,
  to,
  requiresProviderEvidence: true,
});
const local = (from: TransferStatus, to: TransferStatus): TransferTransition => ({
  from,
  to,
  requiresProviderEvidence: false,
});

/** The state machine. Must stay identical to `transfer_status_transitions`. */
export const TRANSFER_TRANSITIONS: readonly TransferTransition[] = [
  provider('DRAFT', 'AWAITING_FUNDS'),
  provider('DRAFT', 'PROCESSING'),
  local('DRAFT', 'FAILED'),
  local('DRAFT', 'CANCELLED'),

  provider('AWAITING_FUNDS', 'PROCESSING'),
  provider('AWAITING_FUNDS', 'SENT'),
  provider('AWAITING_FUNDS', 'COMPLETED'),
  local('AWAITING_FUNDS', 'FAILED'),
  local('AWAITING_FUNDS', 'CANCELLED'),

  provider('PROCESSING', 'SENT'),
  provider('PROCESSING', 'COMPLETED'),
  provider('PROCESSING', 'REFUNDED'),
  provider('PROCESSING', 'CANCELLED'),
  local('PROCESSING', 'FAILED'),

  provider('SENT', 'COMPLETED'),
  provider('SENT', 'REFUNDED'),
  provider('SENT', 'FAILED'),

  provider('COMPLETED', 'REFUNDED'),
  provider('COMPLETED', 'FAILED'),

  // A provider sometimes reports a late success for something recorded as
  // failed. Only the provider can make that correction.
  provider('FAILED', 'PROCESSING'),
  provider('FAILED', 'SENT'),
  provider('FAILED', 'COMPLETED'),
  provider('FAILED', 'REFUNDED'),
];

export function findTransition(
  from: TransferStatus,
  to: TransferStatus,
): TransferTransition | undefined {
  return TRANSFER_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** No further provider activity is expected (it can still be corrected). */
export function isSettled(status: TransferStatus): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'FAILED' ||
    (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(status)
  );
}
