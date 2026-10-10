import type { TransferNotice } from './transfer-messages.ts';

/** Sends a customer their transfer updates. Implementations must not log the message text in production. */
export interface TransferMailer {
  sendTransferNotice(to: string, notice: TransferNotice): Promise<void>;
}

/** Which notifications were sent, so none goes out twice. */
export interface NotificationLog {
  wasSent(transferId: string, kind: string): Promise<boolean>;
  markSent(transferId: string, userId: string, kind: string): Promise<void>;
}
