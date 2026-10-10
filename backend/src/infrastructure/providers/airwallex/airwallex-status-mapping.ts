import type { CustomerStatus } from '../../../domain/payout/models.ts';
import type { TransferStatus } from '../../../domain/payout/transfer-status.ts';

/**
 * Airwallex transfer status (API version 2025-06-30 or later) -> SomPay
 * status. Documented in docs/STATUSES.md; keep the two in step. Returns `null`
 * for a status this adapter does not know, so the transfer is left unchanged.
 *
 * Source: Airwallex docs, "Transfer statuses".
 */
export const AIRWALLEX_TRANSFER_STATUSES = [
  'IN_APPROVAL',
  'APPROVAL_RECALLED',
  'APPROVAL_REJECTED',
  'APPROVAL_BLOCKED',
  'SCHEDULED',
  'OVERDUE',
  'PROCESSING',
  'SENT',
  'PAID',
  'FAILED',
  'CANCELLED',
] as const;

export function mapAirwallexStatus(status: string): TransferStatus | null {
  switch (status) {
    // The transfer exists but is not being processed yet: either it is in the
    // approval workflow (only when transfers are submitted for approval in the
    // Airwallex web app), scheduled for its transfer date, or not funded by then.
    case 'IN_APPROVAL':
    case 'APPROVAL_RECALLED':
    case 'APPROVAL_REJECTED':
    case 'APPROVAL_BLOCKED':
    case 'SCHEDULED':
    case 'OVERDUE':
      return 'AWAITING_FUNDS';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'SENT':
      return 'SENT';
    // Processed successfully by the banking partner. It can still fail later.
    case 'PAID':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return null;
  }
}

/**
 * Connected account status -> customer verification status.
 * Source: Airwallex API reference, "Retrieve an account" (`status`).
 */
export function mapAirwallexAccountStatus(status: string): CustomerStatus {
  switch (status) {
    case 'ACTIVE':
      return 'VERIFIED';
    case 'CREATED':
    case 'SUBMITTED':
    case 'ACTION_REQUIRED':
      return 'PENDING';
    // "Disabled or failed onboarding verification."
    case 'SUSPENDED':
      return 'REJECTED';
    // DORMANT, CLOSED or anything unknown: the account cannot be used as is.
    default:
      return 'NEEDS_RELINK';
  }
}
