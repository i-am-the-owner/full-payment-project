import { ForbiddenError, NotFoundError } from '../../shared/errors.ts';
import { TERMINAL_TRANSFER_STATUSES } from '../../domain/payout/transfer-status.ts';
import type { Recipient, Transfer, TransferEvent } from '../../domain/transfer/models.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import type { ApplyProviderTransferUpdate } from './apply-provider-transfer-update.ts';
import type { CustomerLinkStore, RecipientRepository, TransferRepository } from './ports.ts';

export type ListRecipients = (userId: string) => Promise<Recipient[]>;

export function createListRecipients(deps: {
  recipientRepository: RecipientRepository;
}): ListRecipients {
  return (userId) => deps.recipientRepository.listForUser(userId);
}

export interface TransferPage {
  readonly transfers: Transfer[];
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
}

export type ListTransfers = (
  userId: string,
  paging: { page: number; pageSize: number },
) => Promise<TransferPage>;

/** A page of the customer's transfers, newest first, from our own database. */
export function createListTransfers(deps: {
  transferRepository: TransferRepository;
}): ListTransfers {
  return async (userId, { page, pageSize }) => {
    // One extra row tells us whether another page exists.
    const rows = await deps.transferRepository.listForUser(userId, {
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
    });
    return {
      transfers: rows.slice(0, pageSize),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  };
}

export interface TransferDetail {
  readonly transfer: Transfer;
  readonly events: TransferEvent[];
  /** The recipient summary, even if the recipient has since been removed. */
  readonly recipient: Recipient | undefined;
}

export type GetTransferDetail = (userId: string, transferId: string) => Promise<TransferDetail>;

/** One transfer with its status timeline. Never calls the provider. */
export function createGetTransferDetail(deps: {
  transferRepository: TransferRepository;
  recipientRepository: RecipientRepository;
}): GetTransferDetail {
  return async (userId, transferId) => {
    const transfer = await ownTransfer(deps.transferRepository, userId, transferId);
    const [events, recipient] = await Promise.all([
      deps.transferRepository.listEvents(transfer.id),
      deps.recipientRepository.findById(transfer.recipientId),
    ]);
    return { transfer, events, recipient: recipient ?? undefined };
  };
}

export type GetTransfer = (userId: string, transferId: string) => Promise<Transfer>;

async function ownTransfer(
  transferRepository: TransferRepository,
  userId: string,
  transferId: string,
): Promise<Transfer> {
  const transfer = await transferRepository.findById(transferId);
  if (!transfer) {
    throw new NotFoundError('That transfer could not be found.');
  }
  if (transfer.userId !== userId) {
    throw new ForbiddenError('That transfer belongs to another account.');
  }
  return transfer;
}

/** History is served from our own copy; it never calls the provider. */
export function createGetTransfer(deps: { transferRepository: TransferRepository }): GetTransfer {
  return (userId, transferId) => ownTransfer(deps.transferRepository, userId, transferId);
}

export type RefreshTransfer = (userId: string, transferId: string) => Promise<Transfer>;

/**
 * An explicit, on-demand check of a transfer at the provider. The provider's
 * answer is applied as provider evidence, so this is also how a transfer
 * recorded as FAILED is corrected when the provider in fact completed it.
 */
export function createRefreshTransfer(deps: {
  provider: PayoutProvider;
  customerLinkStore: CustomerLinkStore;
  transferRepository: TransferRepository;
  applyProviderTransferUpdate: ApplyProviderTransferUpdate;
  clock: () => Date;
}): RefreshTransfer {
  return async (userId, transferId) => {
    const transfer = await ownTransfer(deps.transferRepository, userId, transferId);
    if (
      !transfer.providerTransferId ||
      transfer.provider !== deps.provider.name ||
      (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(transfer.status)
    ) {
      return transfer;
    }
    const record = await deps.customerLinkStore.find(userId, deps.provider.name);
    if (!record) {
      return transfer;
    }

    const found = await deps.provider.getTransfer({
      link: record.link,
      transferRef: transfer.providerTransferId,
    });
    if (found.status === null) {
      return transfer;
    }
    const outcome = await deps.applyProviderTransferUpdate({
      source: 'provider_lookup',
      provider: deps.provider.name,
      providerTransferId: transfer.providerTransferId,
      providerStatus: found.providerStatus,
      status: found.status,
      occurredAt: deps.clock(),
    });
    return outcome.applied ? outcome.transfer : transfer;
  };
}
