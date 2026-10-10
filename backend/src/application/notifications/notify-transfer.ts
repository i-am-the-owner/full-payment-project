import { PROVIDER_DISPLAY_NAMES } from '../../domain/payout/models.ts';
import { formatMinorUnits } from '../../shared/money.ts';
import type { Money } from '../../domain/payout/models.ts';
import type { Logger } from '../../shared/logger.ts';
import type {
  CurrencyRegistry,
  RecipientRepository,
  TransferRepository,
} from '../transfer/ports.ts';
import type { NotificationLog, TransferMailer } from './ports.ts';
import { composeTransferNotice, type NotificationKind } from './transfer-messages.ts';

const KINDS: readonly NotificationKind[] = [
  'FUNDS_RECEIVED',
  'SENT',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
];

export interface NotifyTransferDeps {
  readonly transferRepository: TransferRepository;
  readonly recipientRepository: RecipientRepository;
  readonly currencyRegistry: CurrencyRegistry;
  readonly notificationLog: NotificationLog;
  readonly mailer: TransferMailer;
  /** The email of an active account; null if there is none. */
  readonly findUserEmail: (userId: string) => Promise<string | null>;
  readonly supportEmail: string;
  readonly logger: Logger;
}

/**
 * The `notify_transfer` job: emails the customer about one status change. A
 * second run for the same (transfer, kind) sends nothing; a failure to send
 * throws, so the job queue retries it.
 */
export function createNotifyTransfer(
  deps: NotifyTransferDeps,
): (payload: Readonly<Record<string, unknown>>) => Promise<void> {
  const show = async (money: Money): Promise<string> =>
    `${formatMinorUnits(money.amountMinor, await deps.currencyRegistry.minorUnitExponent(money.currency))} ${money.currency}`;

  return async (payload) => {
    const transferId = payload.transferId;
    const kind = payload.kind;
    if (
      typeof transferId !== 'string' ||
      typeof kind !== 'string' ||
      !(KINDS as readonly string[]).includes(kind)
    ) {
      throw new Error('notify_transfer needs a transferId and a known kind');
    }
    if (await deps.notificationLog.wasSent(transferId, kind)) {
      return;
    }
    const transfer = await deps.transferRepository.findById(transferId);
    if (!transfer) {
      return;
    }
    const email = await deps.findUserEmail(transfer.userId);
    if (!email) {
      deps.logger.info('notification.skipped', { transferId, kind, reason: 'no_active_account' });
      return;
    }
    const recipient = await deps.recipientRepository.findById(transfer.recipientId);

    const notice = composeTransferNotice({
      kind: kind as NotificationKind,
      youPaid: await show(transfer.totalToPay),
      recipientGets: await show(transfer.target),
      recipientName: recipient?.displayName ?? 'your recipient',
      providerName: transfer.provider
        ? PROVIDER_DISPLAY_NAMES[transfer.provider]
        : 'our payment partner',
      reference: transfer.reference,
      supportEmail: deps.supportEmail,
    });
    await deps.mailer.sendTransferNotice(email, notice);
    await deps.notificationLog.markSent(transfer.id, transfer.userId, kind);
    deps.logger.info('notification.sent', { transferId, kind });
  };
}
