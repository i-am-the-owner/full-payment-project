import type { TransferStatus } from '../../domain/payout/transfer-status.ts';

export type NotificationKind =
  'FUNDS_RECEIVED' | 'SENT' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED' | 'FAILED';

/**
 * Which customer message, if any, a status change calls for. Moving to
 * AWAITING_FUNDS (the transfer was created) and recovering from FAILED back to
 * PROCESSING are not announced.
 */
export function notificationKindFor(
  from: TransferStatus,
  to: TransferStatus,
): NotificationKind | null {
  switch (to) {
    case 'PROCESSING':
      return from === 'AWAITING_FUNDS' || from === 'DRAFT' ? 'FUNDS_RECEIVED' : null;
    case 'SENT':
      return 'SENT';
    case 'COMPLETED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'FAILED':
      return 'FAILED';
    default:
      return null;
  }
}

export interface TransferMessageFacts {
  readonly kind: NotificationKind;
  /** Formatted with the currency's own decimal places, e.g. `100.00 GBP`. */
  readonly youPaid: string;
  readonly recipientGets: string;
  readonly recipientName: string;
  /** The provider's name for customers, e.g. `Wise`. */
  readonly providerName: string;
  /** SomPay's reference for the transfer. */
  readonly reference: string;
  readonly supportEmail: string;
}

export interface TransferNotice {
  readonly kind: NotificationKind;
  readonly subject: string;
  readonly text: string;
  readonly reference: string;
}

/** Plain-English messages for the customer. Amounts and the recipient's name are always included. */
export function composeTransferNotice(facts: TransferMessageFacts): TransferNotice {
  const { youPaid, recipientGets, recipientName: to, providerName: provider } = facts;
  const ref = `Your reference: ${facts.reference}`;
  let subject: string;
  let body: string;

  switch (facts.kind) {
    case 'FUNDS_RECEIVED':
      subject = `${provider} has received your ${youPaid}`;
      body =
        `${provider} has received your payment of ${youPaid}.\n` +
        `They are now sending ${recipientGets} to ${to}. ` +
        `We will email you again when it is on its way.`;
      break;
    case 'SENT':
      subject = `Your ${recipientGets} is on its way to ${to}`;
      body =
        `${provider} has sent ${recipientGets} to ${to}.\n` +
        `You paid ${youPaid}. We will email you again when ${to} has received it.`;
      break;
    case 'DELIVERED':
      subject = `${to} has received ${recipientGets}`;
      body =
        `Good news: ${to} has received ${recipientGets}.\n` +
        `You paid ${youPaid}. Thank you for using SomPay.`;
      break;
    case 'CANCELLED':
      subject = `Your transfer to ${to} was cancelled`;
      body =
        `Your transfer of ${youPaid} to ${to} was cancelled, so no money has been sent to them.\n` +
        `If you had already paid ${provider}, they will return your ${youPaid} to you. ` +
        `You do not need to do anything.`;
      break;
    case 'REFUNDED':
      subject = `Your ${youPaid} has been sent back to you`;
      body =
        `${provider} has sent back the money for your transfer to ${to}, ` +
        `because it could not be completed.\n` +
        `Look for ${youPaid} in the account you paid from. ` +
        `If you do not see it soon, contact us at ${facts.supportEmail}.`;
      break;
    case 'FAILED':
      subject = `We could not deliver your transfer to ${to}`;
      body =
        `Sorry: your transfer of ${recipientGets} to ${to} did not go through.\n` +
        `Your money is not lost. ${provider} will return your ${youPaid} to you, ` +
        `and we will email you again when they have. You do not need to do anything.\n` +
        `We have been told about this and are keeping an eye on it. ` +
        `If you have questions, contact us at ${facts.supportEmail}.`;
      break;
  }
  return { kind: facts.kind, subject, text: `${body}\n\n${ref}\n`, reference: facts.reference };
}
