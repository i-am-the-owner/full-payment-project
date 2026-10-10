import type { CustomerStatus } from '../../../domain/payout/models.ts';
import type { TransferStatus } from '../../../domain/payout/transfer-status.ts';
import type { WiseTransferStatus } from './wise-models.ts';

/**
 * Wise transfer state -> SomPay status. Documented in docs/STATUSES.md; keep
 * the two in step. Returns `null` for a state with no SomPay meaning, in which
 * case the caller leaves the transfer's status alone.
 *
 * Wise has no "delivered" state: `outgoing_payment_sent` is its last success
 * state and means Wise has paid out, so it maps to SENT, not COMPLETED.
 */
export function mapWiseStatus(wise: WiseTransferStatus): TransferStatus | null {
  switch (wise) {
    case 'incoming_payment_waiting':
      return 'AWAITING_FUNDS';
    case 'incoming_payment_initiated':
    case 'processing':
    case 'funds_converted':
      return 'PROCESSING';
    case 'outgoing_payment_sent':
      return 'SENT';
    case 'bounced_back':
    case 'charged_back':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    case 'funds_refunded':
      return 'REFUNDED';
    case 'unknown':
      return null;
  }
}

/**
 * Wise KYC review state (`kyc-reviews#state-change`) -> customer verification
 * status. Only the two states Wise documents are mapped: PASSED means no
 * further customer action is needed; WAITING_CUSTOMER_INPUT means KYC data is
 * still required. Any other state returns `null` and is left unchanged.
 * Source: Wise docs, "KYC state change webhook".
 */
export function mapWiseKycState(state: string): CustomerStatus | null {
  switch (state) {
    case 'PASSED':
      return 'VERIFIED';
    case 'WAITING_CUSTOMER_INPUT':
      return 'PENDING';
    default:
      return null;
  }
}
