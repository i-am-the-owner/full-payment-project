import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import type { DynamicForm, FormValues } from '../../domain/payout/models.ts';
import type { Recipient } from '../../domain/transfer/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { FraudSignals } from '../fraud/fraud-signals.ts';
import { requireVerifiedLink } from '../payout/customer-onboarding.ts';
import type { PayoutProvider } from '../payout/payout-provider.ts';
import { toPayoutQuote } from './mappers.ts';
import type { CustomerLinkStore, QuoteRepository, RecipientRepository } from './ports.ts';

export interface RecipientFormInput {
  readonly userId: string;
  readonly currency: string;
  readonly country: string;
  /** Optional: the quote the recipient is for, so the provider can tailor the form. */
  readonly quoteId?: string | undefined;
  readonly partialValues?: FormValues | undefined;
}

export type GetRecipientForm = (input: RecipientFormInput) => Promise<DynamicForm>;

export interface RecipientDeps {
  readonly provider: PayoutProvider;
  readonly customerLinkStore: CustomerLinkStore;
  readonly quoteRepository: QuoteRepository;
  readonly recipientRepository: RecipientRepository;
  readonly auditLog: AuditLog;
  /** Alerts an admin to unusual activity. Optional. */
  readonly fraudSignals?: FraudSignals | undefined;
}

/** The recipient form comes from the provider at runtime; nothing is hard-coded. */
export function createGetRecipientForm(deps: RecipientDeps): GetRecipientForm {
  return async (input) => {
    const link = await requireVerifiedLink(deps, input.userId);

    let quote;
    if (input.quoteId !== undefined) {
      const stored = await deps.quoteRepository.findById(input.quoteId);
      if (!stored) {
        throw new NotFoundError('That quote could not be found.');
      }
      if (stored.userId !== input.userId) {
        throw new ForbiddenError('That quote belongs to another account.');
      }
      if (stored.target.currency !== input.currency) {
        throw new ValidationError('The recipient currency does not match the quote.');
      }
      quote = toPayoutQuote(stored);
    }

    return deps.provider.getRecipientForm({
      link,
      currency: input.currency,
      country: input.country,
      ...(quote ? { quote } : {}),
      ...(input.partialValues ? { partialValues: input.partialValues } : {}),
    });
  };
}

export interface AddRecipientInput {
  readonly userId: string;
  readonly currency: string;
  readonly country: string;
  readonly values: FormValues;
  /** Optional nickname; defaults to the account holder's name. */
  readonly displayName?: string | undefined;
}

export type AddRecipient = (input: AddRecipientInput) => Promise<Recipient>;

/**
 * Creates the recipient at the provider, which validates and keeps the bank
 * details. SomPay stores only the summary the provider returns: the submitted
 * values are never written to our database, logs or audit trail.
 */
export function createAddRecipient(deps: RecipientDeps): AddRecipient {
  return async (input) => {
    const link = await requireVerifiedLink(deps, input.userId);

    const created = await deps.provider.createRecipient({
      link,
      currency: input.currency,
      country: input.country,
      values: input.values,
    });

    const recipient = await deps.recipientRepository.create({
      userId: input.userId,
      displayName: input.displayName?.trim() || created.name,
      accountHolderName: created.name,
      countryCode: created.country,
      currencyCode: created.currency,
      accountSummary: created.accountSummary,
      provider: deps.provider.name,
      providerRecipientId: created.id,
    });

    await deps.auditLog.record({
      actorType: 'user',
      actorId: input.userId,
      action: 'recipient.created',
      entityType: 'recipient',
      entityId: recipient.id,
      context: {
        provider: deps.provider.name,
        country: created.country,
        currency: created.currency,
      },
    });

    await deps.fraudSignals?.afterRecipientAdded(input.userId);
    return recipient;
  };
}

export type RemoveRecipient = (userId: string, recipientId: string) => Promise<void>;

/**
 * Removes a recipient from the customer's list. A soft delete: the summary is
 * kept because past transfers refer to it, but it can no longer be sent to.
 */
export function createRemoveRecipient(deps: {
  recipientRepository: RecipientRepository;
  auditLog: AuditLog;
}): RemoveRecipient {
  return async (userId, recipientId) => {
    const recipient = await deps.recipientRepository.findById(recipientId);
    if (!recipient) {
      throw new NotFoundError('That recipient could not be found.');
    }
    if (recipient.userId !== userId) {
      throw new ForbiddenError('That recipient belongs to another account.');
    }
    if (!recipient.isActive) {
      return;
    }
    await deps.recipientRepository.archive(recipient.id);
    await deps.auditLog.record({
      actorType: 'user',
      actorId: userId,
      action: 'recipient.removed',
      entityType: 'recipient',
      entityId: recipient.id,
    });
  };
}
