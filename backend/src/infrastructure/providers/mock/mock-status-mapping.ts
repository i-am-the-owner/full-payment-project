import type { TransferStatus } from '../../../domain/payout/transfer-status.ts';

/**
 * The mock provider's own status vocabulary. It is deliberately different from
 * SomPay's enum so the mapping layer is exercised the same way it is for a
 * real provider.
 */
export const MOCK_TRANSFER_STATUSES = [
  'pending_funding',
  'funded',
  'paid_out',
  'delivered',
  'cancelled',
  'returned',
  'rejected',
] as const;

export type MockTransferStatus = (typeof MOCK_TRANSFER_STATUSES)[number];

export function isMockTransferStatus(value: unknown): value is MockTransferStatus {
  return typeof value === 'string' && (MOCK_TRANSFER_STATUSES as readonly string[]).includes(value);
}

/** Mock status -> SomPay status. Documented in docs/STATUSES.md. */
export function mapMockStatus(status: string): TransferStatus | null {
  switch (status) {
    case 'pending_funding':
      return 'AWAITING_FUNDS';
    case 'funded':
      return 'PROCESSING';
    case 'paid_out':
      return 'SENT';
    case 'delivered':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    case 'returned':
      return 'REFUNDED';
    case 'rejected':
      return 'FAILED';
    default:
      return null;
  }
}
