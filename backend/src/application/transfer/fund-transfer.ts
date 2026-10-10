import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.ts';
import {
  PayoutError,
  ProviderUnavailableError,
  ScaRequiredError,
} from '../../domain/payout/errors.ts';
import {
  PROVIDER_DISPLAY_NAMES,
  type FundingInstructions,
  type FundingMethod,
  type PayoutTransfer,
  type ProviderCustomerLink,
  type ProviderName,
} from '../../domain/payout/models.ts';
import type { Transfer } from '../../domain/transfer/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { requireVerifiedLink } from '../payout/customer-onboarding.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import { toPayoutTransferRef } from './mappers.ts';
import type { CustomerLinkStore, TransferRepository } from './ports.ts';

export interface FundingDeps {
  readonly provider: PayoutProvider;
  readonly customerLinkStore: CustomerLinkStore;
  readonly transferRepository: TransferRepository;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
}

export interface TransferFunding {
  readonly transfer: Transfer;
  /** The licensed provider the customer pays. Never SomPay. */
  readonly provider: { readonly name: ProviderName; readonly displayName: string };
  /** The ways the customer can pay the provider for this transfer. */
  readonly methods: readonly FundingInstructions[];
}

export type GetTransferFunding = (userId: string, transferId: string) => Promise<TransferFunding>;

export type FundTransferOutcome =
  /** The provider took the money: the transfer moves on. */
  | 'FUNDED'
  /** Nothing more to do here: the provider is waiting for the customer's payment. */
  | 'AWAITING_PAYMENT'
  /** The customer must approve the payment with the provider first. */
  | 'SCA_REQUIRED'
  /** The provider refused this way of paying; the transfer is unchanged. */
  | 'REJECTED';

export interface FundTransferResult {
  readonly outcome: FundTransferOutcome;
  readonly transfer: Transfer;
  /** What to show the customer, when there is something they must do or know. */
  readonly message: string | undefined;
}

export type FundTransfer = (input: {
  userId: string;
  transferId: string;
  method: FundingMethod;
}) => Promise<FundTransferResult>;

async function payable(
  deps: FundingDeps,
  userId: string,
  transferId: string,
): Promise<{ transfer: Transfer; providerTransfer: PayoutTransfer; link: ProviderCustomerLink }> {
  const transfer = await deps.transferRepository.findById(transferId);
  if (!transfer) {
    throw new NotFoundError('That transfer could not be found.');
  }
  if (transfer.userId !== userId) {
    throw new ForbiddenError('That transfer belongs to another account.');
  }
  const providerTransfer = toPayoutTransferRef(transfer);
  if (
    transfer.status !== 'AWAITING_FUNDS' ||
    !providerTransfer ||
    transfer.provider !== deps.provider.name
  ) {
    throw new ConflictError('That transfer is not waiting for payment.');
  }
  const link = await requireVerifiedLink(deps, userId);
  return { transfer, providerTransfer, link };
}

/**
 * How to pay the provider for a transfer. The bank details are the provider's
 * own and are fetched from it each time: SomPay neither stores them nor
 * receives the money.
 */
export function createGetTransferFunding(deps: FundingDeps): GetTransferFunding {
  return async (userId, transferId) => {
    const { transfer, providerTransfer, link } = await payable(deps, userId, transferId);
    const methods = await deps.provider.getFundingInstructions({
      link,
      transfer: providerTransfer,
      amount: transfer.totalToPay,
    });
    return {
      transfer,
      provider: {
        name: deps.provider.name,
        displayName: PROVIDER_DISPLAY_NAMES[deps.provider.name],
      },
      methods,
    };
  };
}

/**
 * The customer chooses how to pay. `BALANCE` asks the provider to take the
 * money from the customer's OWN balance at the provider; `BANK_TRANSFER` only
 * records the choice – the customer then pays the provider from their bank.
 * A status only ever changes on the provider's say-so.
 */
export function createFundTransfer(deps: FundingDeps): FundTransfer {
  const name = PROVIDER_DISPLAY_NAMES[deps.provider.name];

  return async (input) => {
    const { transfer, providerTransfer, link } = await payable(
      deps,
      input.userId,
      input.transferId,
    );

    const offered = await deps.provider.getFundingInstructions({
      link,
      transfer: providerTransfer,
      amount: transfer.totalToPay,
    });
    if (!offered.some((option) => option.method === input.method)) {
      throw new ConflictError('That way of paying is not available for this transfer.');
    }

    const audit = (outcome: FundTransferOutcome, code?: string): Promise<void> =>
      deps.auditLog.record({
        actorType: 'user',
        actorId: input.userId,
        action: 'transfer.funding_requested',
        entityType: 'transfer',
        entityId: transfer.id,
        context: { method: input.method, outcome, ...(code ? { code } : {}) },
      });

    let result;
    try {
      result = await deps.provider.fundTransfer({
        link,
        transfer: providerTransfer,
        method: input.method,
      });
    } catch (error) {
      if (error instanceof ScaRequiredError) {
        result = { status: 'SCA_REQUIRED' as const, errorCode: undefined };
      } else {
        if (
          error instanceof PayoutError &&
          !(error instanceof ProviderUnavailableError && error.outcomeUnknown)
        ) {
          await audit('REJECTED', error.code);
        }
        // Typed errors (insufficient funds, provider unavailable, ...) reach the
        // client as they are. When the outcome is unknown nothing is recorded:
        // the provider's webhook or a status check will tell us what happened.
        throw error;
      }
    }

    switch (result.status) {
      case 'COMPLETED': {
        await deps.transferRepository.recordFundingMethod(transfer.id, input.method);
        const funded = await deps.transferRepository.applyProviderStatus(transfer.id, {
          source: 'provider_response',
          provider: deps.provider.name,
          providerTransferId: providerTransfer.id,
          providerStatus: 'funding_completed',
          status: 'PROCESSING',
          occurredAt: deps.clock(),
        });
        await audit('FUNDED');
        return { outcome: 'FUNDED', transfer: funded, message: undefined };
      }
      case 'PENDING':
        await deps.transferRepository.recordFundingMethod(transfer.id, input.method);
        await audit('AWAITING_PAYMENT');
        return {
          outcome: 'AWAITING_PAYMENT',
          transfer,
          message: `${name} is waiting for your payment. We will update this transfer as soon as it arrives.`,
        };
      case 'SCA_REQUIRED':
        await audit('SCA_REQUIRED');
        return {
          outcome: 'SCA_REQUIRED',
          transfer,
          message: `${name} needs you to approve this payment. Open your ${name} account, approve it, then come back and check again.`,
        };
      case 'REJECTED':
        await audit('REJECTED', result.errorCode);
        return {
          outcome: 'REJECTED',
          transfer,
          message: `${name} could not take this payment. You can pay another way.`,
        };
    }
  };
}
