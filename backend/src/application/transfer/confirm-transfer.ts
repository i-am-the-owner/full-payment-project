import { randomBytes } from 'node:crypto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors.ts';
import {
  NotImplementedError,
  NotSupportedError,
  PayoutError,
  ProviderUnavailableError,
  QuoteExpiredError,
} from '../../domain/payout/errors.ts';
import type {
  DynamicForm,
  FormValues,
  PayoutTransfer,
  ProviderCustomerLink,
} from '../../domain/payout/models.ts';
import type { Recipient, Transfer, TransferQuote } from '../../domain/transfer/models.ts';
import type { TransferPause } from '../settings/transfer-pause.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { FraudSignals } from '../fraud/fraud-signals.ts';
import { requireVerifiedLink } from '../payout/customer-onboarding.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import { toPayoutQuote, toPayoutRecipient } from './mappers.ts';
import type {
  CustomerLinkStore,
  QuoteRepository,
  RecipientRepository,
  TransferRepository,
} from './ports.ts';
import type { TransferLimits } from './transfer-limits.ts';

export interface ConfirmTransferInput {
  readonly userId: string;
  readonly quoteId: string;
  readonly recipientId: string;
  /** Answers to the provider's transfer form (see `getTransferForm`). */
  readonly answers: FormValues;
  /** The customer's own reference for the recipient. Optional. */
  readonly reference?: string | undefined;
  readonly idempotencyKey: string;
}

export interface ConfirmTransferResult {
  readonly transfer: Transfer;
  /** True when a previous request with the same idempotency key already created it. */
  readonly wasExisting: boolean;
}

export type ConfirmTransfer = (input: ConfirmTransferInput) => Promise<ConfirmTransferResult>;

export type GetTransferForm = (input: {
  userId: string;
  quoteId: string;
  recipientId: string;
  /** Answers so far, so a provider can add fields that depend on them. */
  partialValues?: FormValues | undefined;
}) => Promise<DynamicForm>;

export interface ConfirmTransferDeps {
  readonly provider: PayoutProvider;
  readonly customerLinkStore: CustomerLinkStore;
  readonly quoteRepository: QuoteRepository;
  readonly recipientRepository: RecipientRepository;
  readonly transferRepository: TransferRepository;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
  /** When set, a NEW transfer cannot be created while paused. Existing ones continue. */
  readonly transferPause?: Pick<TransferPause, 'assertNewTransfersAllowed'> | undefined;
  /** Alerts an admin to unusual activity. Optional. */
  readonly fraudSignals?: FraudSignals | undefined;
  /** Per-customer sending limits, checked before a transfer is created. */
  readonly transferLimits: TransferLimits;
  /**
   * Feature flag (default off). When off, a transfer is created at the provider
   * and left AWAITING_FUNDS: the customer pays the provider directly and a
   * provider-held balance is never drawn on by SomPay.
   */
  readonly balanceFundingEnabled?: boolean;
}

/** A Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

/**
 * A key replayed with a different quote or recipient is a client bug (or an
 * attack), not a retry: returning the earlier transfer would hide it, so say 409.
 */
function assertSameRequest(
  existing: Transfer,
  input: { quoteId: string; recipientId: string },
): void {
  if (existing.quoteId !== input.quoteId || existing.recipientId !== input.recipientId) {
    throw new ConflictError(
      'That request key was already used for a different transfer. Please start again.',
    );
  }
}

function generateReference(): string {
  return `ALM-${randomBytes(5).toString('hex').toUpperCase()}`;
}

/**
 * True when a provider failure may still have taken effect (no response, a 5xx
 * or an unreadable answer). The transfer must then stay pending: the provider
 * may have created or funded it.
 */
function outcomeUnknown(error: PayoutError): boolean {
  return error instanceof ProviderUnavailableError && error.outcomeUnknown;
}

async function loadOwned(
  deps: ConfirmTransferDeps,
  input: { userId: string; quoteId: string; recipientId: string },
): Promise<{ quote: TransferQuote; recipient: Recipient }> {
  const quote = await deps.quoteRepository.findById(input.quoteId);
  if (!quote) {
    throw new NotFoundError('That quote could not be found.');
  }
  if (quote.userId !== input.userId) {
    throw new ForbiddenError('That quote belongs to another account.');
  }
  if (quote.expiresAt.getTime() <= deps.clock().getTime()) {
    throw new QuoteExpiredError();
  }
  if (quote.provider !== deps.provider.name) {
    throw new QuoteExpiredError('That quote can no longer be used. Please request a new one.');
  }

  const recipient = await deps.recipientRepository.findById(input.recipientId);
  if (!recipient) {
    throw new NotFoundError('That recipient could not be found.');
  }
  if (recipient.userId !== input.userId) {
    throw new ForbiddenError('That recipient belongs to another account.');
  }
  if (!recipient.isActive) {
    throw new ValidationError('That recipient is no longer active.');
  }
  if (recipient.currencyCode !== quote.target.currency) {
    throw new ValidationError('The recipient currency does not match the quote.');
  }
  return { quote, recipient };
}

/** The provider's extra questions for this transfer (e.g. purpose). */
export function createGetTransferForm(deps: ConfirmTransferDeps): GetTransferForm {
  return async (input) => {
    const link = await requireVerifiedLink(deps, input.userId);
    const { quote, recipient } = await loadOwned(deps, input);
    return deps.provider.getTransferForm({
      link,
      quote: toPayoutQuote(quote),
      recipient: toPayoutRecipient(recipient, deps.provider.name),
      ...(input.partialValues ? { partialValues: input.partialValues } : {}),
    });
  };
}

/**
 * Creates a transfer from a valid, unexpired quote. Idempotent at three layers:
 *   1. a fast lookup by (userId, idempotencyKey);
 *   2. the DB unique constraints on (user_id, idempotency_key) and on quote_id;
 *   3. the provider dedupes on our own transfer UUID.
 * A duplicate request therefore always returns the original transfer, and a
 * request that may already have created a provider transfer is never repeated
 * under a new key.
 */
export function createConfirmTransfer(deps: ConfirmTransferDeps): ConfirmTransfer {
  return async (input) => {
    const existing = await deps.transferRepository.findByIdempotencyKey(
      input.userId,
      input.idempotencyKey,
    );
    if (existing) {
      assertSameRequest(existing, input);
      return { transfer: await resumeIfUnsubmitted(deps, existing), wasExisting: true };
    }

    // A replay of a transfer that already exists (above) still works while paused;
    // only a brand new transfer is stopped.
    await deps.transferPause?.assertNewTransfersAllowed();
    const link = await requireVerifiedLink(deps, input.userId);
    const { quote, recipient } = await loadOwned(deps, input);
    // Fails before anything is written if the recipient is not usable.
    toPayoutRecipient(recipient, deps.provider.name);
    // Limits count everything the customer pays, fee included.
    await deps.transferLimits.check(input.userId, quote.totalToPay);

    const reference = generateReference();

    let transfer: Transfer;
    try {
      transfer = await deps.transferRepository.create({
        reference,
        userId: input.userId,
        recipientId: recipient.id,
        quoteId: quote.id,
        idempotencyKey: input.idempotencyKey,
        source: quote.source,
        fee: quote.fee,
        target: quote.target,
        exchangeRate: quote.exchangeRate,
        answers: input.answers,
        recipientReference: input.reference,
      });
    } catch (error) {
      // A concurrent request won the race – return its transfer.
      const raced = await deps.transferRepository.findByIdempotencyKey(
        input.userId,
        input.idempotencyKey,
      );
      if (raced) {
        assertSameRequest(raced, input);
        return { transfer: raced, wasExisting: true };
      }
      // The quote was already consumed under a different key: same transfer.
      const sameQuote = await deps.transferRepository.findByQuoteId(quote.id);
      if (sameQuote && sameQuote.userId === input.userId) {
        assertSameRequest(sameQuote, input);
        return { transfer: sameQuote, wasExisting: true };
      }
      // Someone else already used this key. Say so without saying whose it is.
      if (isUniqueViolation(error)) {
        throw new ConflictError('That request key has already been used. Please start again.');
      }
      throw error;
    }

    await deps.auditLog.record({
      actorType: 'user',
      actorId: input.userId,
      action: 'transfer.confirmed',
      entityType: 'transfer',
      entityId: transfer.id,
      context: {
        reference,
        quoteId: quote.id,
        recipientId: recipient.id,
        sourceAmountMinor: quote.source.amountMinor.toString(),
        feeAmountMinor: quote.fee.amountMinor.toString(),
        targetAmountMinor: quote.target.amountMinor.toString(),
      },
    });

    const submitted = await submitToProvider(deps, { link, transfer, quote, recipient });
    return { transfer: submitted, wasExisting: false };
  };
}

/**
 * A transfer still in DRAFT with no provider transfer id was never confirmed as
 * submitted (the process died, or the provider gave no usable answer). Before
 * anything is sent again the provider is asked whether a transfer with our
 * idempotency key already exists:
 *   - it does: that transfer is adopted, nothing is created;
 *   - it does not: the create is sent again with the SAME key;
 *   - the provider has no such lookup: the create is sent again with the same
 *     key, which such a provider must dedupe on;
 *   - the lookup itself fails: nothing is sent – the transfer stays pending.
 */
async function resumeIfUnsubmitted(
  deps: ConfirmTransferDeps,
  transfer: Transfer,
): Promise<Transfer> {
  if (transfer.status !== 'DRAFT' || transfer.providerTransferId) {
    return transfer;
  }
  const [quote, recipient] = await Promise.all([
    deps.quoteRepository.findById(transfer.quoteId),
    deps.recipientRepository.findById(transfer.recipientId),
  ]);
  if (!quote || !recipient || quote.provider !== deps.provider.name) {
    return transfer;
  }
  const link = await requireVerifiedLink(deps, transfer.userId);

  let existing: PayoutTransfer | null = null;
  try {
    existing = await deps.provider.findTransferByIdempotencyKey({
      link,
      idempotencyKey: transfer.id,
    });
  } catch (error) {
    if (!(error instanceof PayoutError)) {
      throw error;
    }
    if (!(error instanceof NotSupportedError || error instanceof NotImplementedError)) {
      await deps.auditLog.record({
        actorType: 'system',
        action: 'transfer.outcome_unconfirmed',
        entityType: 'transfer',
        entityId: transfer.id,
        context: { step: 'lookup', code: error.code, status: transfer.status },
      });
      return transfer;
    }
  }
  return submitToProvider(deps, { link, transfer, quote, recipient, resume: { existing } });
}

/**
 * Creates the provider transfer. A definitive rejection fails the SomPay
 * transfer with a mapped reason. A failure whose outcome is unknown leaves it
 * pending so it can be reconciled instead of being reported as failed.
 */
async function submitToProvider(
  deps: ConfirmTransferDeps,
  ctx: {
    link: ProviderCustomerLink;
    transfer: Transfer;
    quote: TransferQuote;
    recipient: Recipient;
    /** Set when an earlier attempt may already have reached the provider. */
    resume?: { existing: PayoutTransfer | null };
  },
): Promise<Transfer> {
  const { link, transfer } = ctx;
  const provider = deps.provider;

  const fail = async (reason: string): Promise<Transfer> => {
    const failed = await deps.transferRepository.applyLocalStatusChange(transfer.id, {
      status: 'FAILED',
      failureReason: reason,
      actor: 'system',
    });
    await deps.auditLog.record({
      actorType: 'system',
      action: 'transfer.failed',
      entityType: 'transfer',
      entityId: transfer.id,
      context: { reason },
    });
    await deps.fraudSignals?.afterTransferFailed(transfer.userId);
    return failed;
  };

  const leavePending = async (current: Transfer, step: string, code: string): Promise<Transfer> => {
    await deps.auditLog.record({
      actorType: 'system',
      action: 'transfer.outcome_unconfirmed',
      entityType: 'transfer',
      entityId: transfer.id,
      context: { step, code, status: current.status },
    });
    return current;
  };

  const recipient = toPayoutRecipient(ctx.recipient, provider.name);

  let created: PayoutTransfer;
  if (ctx.resume?.existing) {
    // The earlier attempt did reach the provider: adopt its transfer.
    created = ctx.resume.existing;
  } else {
    // 1. Confirm the price for this recipient. No money is involved yet, so any
    //    failure here can safely fail the transfer. Skipped on a resume: the
    //    first attempt already did it, and failing now could contradict a
    //    transfer the provider may have created.
    let quote = toPayoutQuote(ctx.quote);
    if (!ctx.resume) {
      try {
        quote = await provider.updateQuoteWithRecipient({ link, quote, recipient });
      } catch (error) {
        if (error instanceof PayoutError) {
          return fail(`quote:${error.code}`);
        }
        throw error;
      }
      if (
        quote.sourceAmount.amountMinor !== ctx.quote.totalToPay.amountMinor ||
        quote.targetAmount.amountMinor !== ctx.quote.target.amountMinor ||
        quote.fee.amountMinor !== ctx.quote.fee.amountMinor
      ) {
        // The customer agreed to the stored figures; never send different ones.
        return fail('quote:PRICE_CHANGED');
      }
    }

    // 2. Create the provider transfer. The key is the SomPay transfer's own
    //    UUID: made once with the row, and the same on every retry.
    try {
      created = await provider.createTransfer({
        link,
        quote,
        recipient,
        answers: transfer.answers,
        idempotencyKey: transfer.id,
        reference: transfer.recipientReference ?? transfer.reference,
      });
    } catch (error) {
      if (error instanceof PayoutError) {
        return outcomeUnknown(error)
          ? leavePending(transfer, 'create', error.code)
          : fail(`create:${error.code}`);
      }
      throw error;
    }
  }

  await deps.transferRepository.attachProviderTransfer(transfer.id, provider.name, created.id);
  let current = await deps.transferRepository.applyProviderStatus(transfer.id, {
    source: 'provider_response',
    provider: provider.name,
    providerTransferId: created.id,
    providerStatus: created.providerStatus,
    status: created.status ?? 'AWAITING_FUNDS',
    occurredAt: deps.clock(),
  });

  // 3. Funding from a provider-held balance is behind a feature flag that is
  //    off by default. With it off the transfer stays AWAITING_FUNDS until the
  //    customer pays the provider directly.
  if (deps.balanceFundingEnabled === true && current.status === 'AWAITING_FUNDS') {
    try {
      const funding = await provider.fundTransfer({ link, transfer: created, method: 'BALANCE' });
      if (funding.status === 'COMPLETED') {
        await deps.transferRepository.recordFundingMethod(transfer.id, 'BALANCE');
        current = await deps.transferRepository.applyProviderStatus(transfer.id, {
          source: 'provider_response',
          provider: provider.name,
          providerTransferId: created.id,
          providerStatus: 'funding_completed',
          status: 'PROCESSING',
          occurredAt: deps.clock(),
        });
      } else if (funding.status === 'REJECTED') {
        return fail(`funding:${funding.errorCode ?? 'rejected'}`);
      }
      // SCA_REQUIRED / PENDING: the transfer stays AWAITING_FUNDS.
    } catch (error) {
      if (error instanceof PayoutError) {
        return outcomeUnknown(error)
          ? leavePending(current, 'funding', error.code)
          : fail(`funding:${error.code}`);
      }
      throw error;
    }
  }

  await deps.auditLog.record({
    actorType: 'system',
    action: 'transfer.submitted',
    entityType: 'transfer',
    entityId: transfer.id,
    context: { provider: provider.name, providerTransferId: created.id, status: current.status },
  });
  return current;
}
