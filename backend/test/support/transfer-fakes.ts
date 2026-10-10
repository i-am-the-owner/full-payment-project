import { randomUUID } from 'node:crypto';
import type { AuditLog, AuditLogEntry } from '../../src/application/audit/audit-log.ts';
import type { Job, JobQueue, NewJob } from '../../src/application/jobs/job-queue.ts';
import type {
  AdminAlert,
  AdminAlerts,
  NewAdminAlert,
} from '../../src/application/notifications/admin-alerts.ts';
import type { NotificationLog, TransferMailer } from '../../src/application/notifications/ports.ts';
import type { TransferNotice } from '../../src/application/notifications/transfer-messages.ts';
import type { PayoutProvider } from '../../src/application/payout/payout-provider.ts';
import { CurrencyCatalogue } from '../../src/application/payout/currency-catalogue.ts';
import type {
  CreateQuoteRecord,
  CreateRecipientRecord,
  CreateTransferRecord,
  CurrencyRegistry,
  CustomerLinkRecord,
  CustomerLinkStore,
  CustomerStatusUpdate,
  KycStatus,
  OnboardingStateStore,
  ProfileStore,
  LocalStatusChange,
  Page,
  ProviderStatusEvidence,
  QuoteRepository,
  RecipientRepository,
  TransferRepository,
  StoredWebhookEvent,
  WebhookEventRepository,
  WebhookProcessingResult,
} from '../../src/application/transfer/ports.ts';
import {
  InvalidTransferTransitionError,
  StaleProviderEventError,
  UnknownCurrencyError,
} from '../../src/application/transfer/ports.ts';
import { ProviderUnavailableError } from '../../src/domain/payout/errors.ts';
import type {
  Currency,
  CustomerProfile,
  CustomerStatus,
  FundingMethod,
  NormalisedEvent,
  ProviderCustomerLink,
  ProviderName,
} from '../../src/domain/payout/models.ts';
import { findTransition } from '../../src/domain/payout/transfer-status.ts';
import type {
  Recipient,
  Transfer,
  TransferEvent,
  TransferQuote,
} from '../../src/domain/transfer/models.ts';
import { createTransferLimits } from '../../src/application/transfer/transfer-limits.ts';
import { MockPayoutProvider } from '../../src/infrastructure/providers/mock/mock-payout-provider.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class RecordingAuditLog implements AuditLog {
  readonly entries: AuditLogEntry[] = [];
  record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

export class FakeCurrencyRegistry implements CurrencyRegistry {
  readonly currencies = new Map<string, Currency>();
  minorUnitExponent(currency: string): Promise<number> {
    const found = this.currencies.get(currency);
    return found
      ? Promise.resolve(found.minorUnit)
      : Promise.reject(new UnknownCurrencyError(currency));
  }
  upsertMany(currencies: readonly Currency[]): Promise<void> {
    for (const currency of currencies) {
      this.currencies.set(currency.code, currency);
    }
    return Promise.resolve();
  }
}

interface FakeLink {
  link: ProviderCustomerLink | undefined;
  status: KycStatus;
  /** Whether the provider-verified identity has been compared with our profile. */
  identityChecked: boolean;
  providerStatusAt?: Date | undefined;
}

export class FakeCustomerLinkStore implements CustomerLinkStore {
  /** Keyed by `${userId}:${provider}` – one link per user and provider. */
  readonly records = new Map<string, FakeLink>();
  readonly refreshTokens = new Map<string, string>();

  #key(userId: string, provider: ProviderName): string {
    return `${userId}:${provider}`;
  }
  find(userId: string, provider: ProviderName): Promise<CustomerLinkRecord | null> {
    const record = this.records.get(this.#key(userId, provider));
    return Promise.resolve(record?.link ? { link: record.link, status: record.status } : null);
  }
  status(userId: string, provider: ProviderName): Promise<KycStatus | null> {
    return Promise.resolve(this.records.get(this.#key(userId, provider))?.status ?? null);
  }
  beginLink(userId: string, provider: ProviderName): Promise<void> {
    const key = this.#key(userId, provider);
    if (!this.records.has(key)) {
      this.records.set(key, { link: undefined, status: 'PENDING', identityChecked: false });
    }
    return Promise.resolve();
  }
  saveLink(userId: string, link: ProviderCustomerLink): Promise<void> {
    const key = this.#key(userId, link.provider);
    const existing = this.records.get(key);
    const sameCustomer = existing?.link?.customerRef === link.customerRef;
    this.records.set(key, {
      link,
      status: sameCustomer && existing ? existing.status : 'PENDING',
      identityChecked: sameCustomer && existing ? existing.identityChecked : false,
      providerStatusAt: sameCustomer ? existing?.providerStatusAt : undefined,
    });
    if (!sameCustomer) {
      this.refreshTokens.delete(key);
    }
    return Promise.resolve();
  }
  recordProviderStatus(
    userId: string,
    provider: ProviderName,
    status: CustomerStatus,
  ): Promise<void> {
    const record = this.records.get(this.#key(userId, provider));
    if (
      record?.link &&
      record.status !== 'REJECTED_PENDING_REVIEW' &&
      !(status === 'VERIFIED' && !record.identityChecked)
    ) {
      record.status = status;
    }
    return Promise.resolve();
  }
  markIdentityChecked(userId: string, provider: ProviderName): Promise<void> {
    const record = this.records.get(this.#key(userId, provider));
    if (record) {
      record.identityChecked = true;
    }
    return Promise.resolve();
  }
  recordProviderStatusByRef(
    provider: ProviderName,
    providerRef: string,
    status: CustomerStatus,
    occurredAt: Date,
  ): Promise<CustomerStatusUpdate> {
    for (const [key, record] of this.records) {
      const link = record.link;
      if (!link || link.provider !== provider) continue;
      if (link.customerRef !== providerRef && link.profileRef !== providerRef) continue;
      const userId = key.split(':')[0]!;
      if (record.status === 'REJECTED_PENDING_REVIEW') {
        return Promise.resolve({ outcome: 'held_for_review', userId });
      }
      if (record.providerStatusAt && record.providerStatusAt.getTime() > occurredAt.getTime()) {
        return Promise.resolve({ outcome: 'stale', userId });
      }
      if (status === 'VERIFIED' && !record.identityChecked) {
        return Promise.resolve({ outcome: 'identity_not_checked', userId });
      }
      record.providerStatusAt = occurredAt;
      if (record.status === status) {
        return Promise.resolve({ outcome: 'unchanged', userId });
      }
      const previous = record.status;
      record.status = status;
      return Promise.resolve({ outcome: 'applied', userId, previous });
    }
    return Promise.resolve({ outcome: 'unknown_customer' });
  }
  flagIdentityMismatch(userId: string, provider: ProviderName): Promise<void> {
    const record = this.records.get(this.#key(userId, provider));
    if (record) {
      record.status = 'REJECTED_PENDING_REVIEW';
    }
    return Promise.resolve();
  }
  markNeedsRelink(provider: ProviderName, customerRef: string): Promise<void> {
    for (const record of this.records.values()) {
      if (record.link?.provider === provider && record.link.customerRef === customerRef) {
        record.status = 'NEEDS_RELINK';
      }
    }
    return Promise.resolve();
  }
  saveRefreshToken(userId: string, provider: ProviderName, refreshToken: string): Promise<void> {
    this.refreshTokens.set(this.#key(userId, provider), refreshToken);
    return Promise.resolve();
  }
  readRefreshToken(userId: string, provider: ProviderName): Promise<string | null> {
    return Promise.resolve(this.refreshTokens.get(this.#key(userId, provider)) ?? null);
  }
  readRefreshTokenByRef(provider: ProviderName, customerRef: string): Promise<string | null> {
    for (const [key, record] of this.records) {
      if (record.link?.provider === provider && record.link.customerRef === customerRef) {
        return Promise.resolve(this.refreshTokens.get(key) ?? null);
      }
    }
    return Promise.resolve(null);
  }
  saveRefreshTokenByRef(
    provider: ProviderName,
    customerRef: string,
    refreshToken: string,
  ): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.link?.provider === provider && record.link.customerRef === customerRef) {
        this.refreshTokens.set(key, refreshToken);
      }
    }
    return Promise.resolve();
  }
  /** Test set-up: what provider onboarding would have left behind. */
  seed(userId: string, status: KycStatus = 'VERIFIED', provider: ProviderName = 'mock'): void {
    this.records.set(this.#key(userId, provider), {
      link: { provider, customerRef: `mock-${status.toLowerCase()}-${userId}` },
      status,
      identityChecked: true,
    });
  }
  /** Test set-up: the customer has no link to any provider. */
  unlink(userId: string): void {
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.records.delete(key);
      }
    }
  }
}

export class FakeOnboardingStateStore implements OnboardingStateStore {
  readonly states = new Map<
    string,
    { userId: string; provider: ProviderName; expiresAt: Date; used: boolean }
  >();
  create(input: {
    userId: string;
    provider: ProviderName;
    stateHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.states.set(input.stateHash, { ...input, used: false });
    return Promise.resolve();
  }
  consume(
    stateHash: string,
    now: Date,
  ): Promise<{ userId: string; provider: ProviderName } | null> {
    const state = this.states.get(stateHash);
    if (!state || state.used || state.expiresAt.getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }
    state.used = true;
    return Promise.resolve({ userId: state.userId, provider: state.provider });
  }
}

export class FakeProfileStore implements ProfileStore {
  readonly profiles = new Map<string, CustomerProfile>();
  get(userId: string): Promise<Partial<CustomerProfile>> {
    return Promise.resolve(this.profiles.get(userId) ?? {});
  }
  save(userId: string, profile: CustomerProfile): Promise<void> {
    this.profiles.set(userId, profile);
    return Promise.resolve();
  }
}

export const PROFILE: CustomerProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-04-12',
  countryOfResidence: 'GB',
  phone: '+447700900123',
};

export class FakeQuoteRepository implements QuoteRepository {
  readonly quotes = new Map<string, TransferQuote>();
  create(record: CreateQuoteRecord): Promise<TransferQuote> {
    const quote: TransferQuote = {
      id: randomUUID(),
      userId: record.userId,
      source: record.source,
      fee: record.fee,
      totalToPay: {
        currency: record.source.currency,
        amountMinor: record.source.amountMinor + record.fee.amountMinor,
      },
      target: record.target,
      exchangeRate: record.exchangeRate,
      provider: record.provider,
      providerQuoteId: record.providerQuoteId,
      estimatedDelivery: record.estimatedDelivery,
      expiresAt: record.expiresAt,
      createdAt: new Date(),
    };
    this.quotes.set(quote.id, quote);
    return Promise.resolve(quote);
  }
  findById(id: string): Promise<TransferQuote | null> {
    return Promise.resolve(this.quotes.get(id) ?? null);
  }
  /** Rewrites a stored quote (e.g. to make it expired). */
  patch(id: string, changes: Partial<TransferQuote>): void {
    const quote = this.quotes.get(id);
    if (quote) {
      this.quotes.set(id, { ...quote, ...changes });
    }
  }
}

export class FakeRecipientRepository implements RecipientRepository {
  readonly recipients = new Map<string, Recipient>();
  create(record: CreateRecipientRecord): Promise<Recipient> {
    const recipient: Recipient = {
      id: randomUUID(),
      userId: record.userId,
      displayName: record.displayName,
      accountHolderName: record.accountHolderName,
      countryCode: record.countryCode,
      currencyCode: record.currencyCode,
      accountSummary: record.accountSummary,
      provider: record.provider,
      providerRecipientId: record.providerRecipientId,
      isActive: true,
    };
    this.recipients.set(recipient.id, recipient);
    return Promise.resolve(recipient);
  }
  findById(id: string): Promise<Recipient | null> {
    return Promise.resolve(this.recipients.get(id) ?? null);
  }
  listForUser(userId: string): Promise<Recipient[]> {
    return Promise.resolve(
      [...this.recipients.values()].filter((r) => r.userId === userId && r.isActive),
    );
  }
  countCreatedSince(userId: string, _since: Date): Promise<number> {
    return Promise.resolve([...this.recipients.values()].filter((r) => r.userId === userId).length);
  }
  archive(id: string): Promise<void> {
    const recipient = this.recipients.get(id);
    if (recipient) {
      this.recipients.set(id, { ...recipient, isActive: false });
    }
    return Promise.resolve();
  }
}

/** In-memory transfer store that enforces the same state machine as the DB. */
export class FakeTransferRepository implements TransferRepository {
  readonly transfers = new Map<string, Mutable<Transfer>>();
  readonly events = new Map<string, TransferEvent[]>();
  readonly lastPolled = new Map<string, Date>();
  readonly providerStatusAt = new Map<string, Date>();
  /** Timestamps for new rows; tests move it to place transfers in the past. */
  now: () => Date = () => new Date();
  /** Make the next `create` lose a race to a concurrent request. */
  failNextCreate = false;

  findByIdempotencyKey(userId: string, key: string): Promise<Transfer | null> {
    return Promise.resolve(
      [...this.transfers.values()].find((t) => t.userId === userId && t.idempotencyKey === key) ??
        null,
    );
  }
  findById(id: string): Promise<Transfer | null> {
    return Promise.resolve(this.transfers.get(id) ?? null);
  }
  findByQuoteId(quoteId: string): Promise<Transfer | null> {
    return Promise.resolve([...this.transfers.values()].find((t) => t.quoteId === quoteId) ?? null);
  }
  findByProviderTransferId(provider: ProviderName, id: string): Promise<Transfer | null> {
    return Promise.resolve(
      [...this.transfers.values()].find(
        (t) => t.provider === provider && t.providerTransferId === id,
      ) ?? null,
    );
  }
  listForUser(userId: string, page: Page): Promise<Transfer[]> {
    const newestFirst = [...this.transfers.values()].filter((t) => t.userId === userId).reverse();
    return Promise.resolve(newestFirst.slice(page.offset, page.offset + page.limit));
  }
  listEvents(transferId: string): Promise<TransferEvent[]> {
    return Promise.resolve(this.events.get(transferId) ?? []);
  }
  totalPaidSince(userId: string, currency: string, since: Date): Promise<bigint> {
    let total = 0n;
    for (const t of this.transfers.values()) {
      if (
        t.userId === userId &&
        t.totalToPay.currency === currency &&
        t.createdAt.getTime() >= since.getTime() &&
        !['CANCELLED', 'FAILED', 'REFUNDED'].includes(t.status)
      ) {
        total += t.totalToPay.amountMinor;
      }
    }
    return Promise.resolve(total);
  }
  create(record: CreateTransferRecord): Promise<Transfer> {
    const build = (overrides: Partial<Transfer> = {}): Mutable<Transfer> => ({
      id: randomUUID(),
      reference: record.reference,
      userId: record.userId,
      recipientId: record.recipientId,
      quoteId: record.quoteId,
      status: 'DRAFT',
      idempotencyKey: record.idempotencyKey,
      source: record.source,
      fee: record.fee,
      totalToPay: {
        currency: record.source.currency,
        amountMinor: record.source.amountMinor + record.fee.amountMinor,
      },
      target: record.target,
      exchangeRate: record.exchangeRate,
      answers: record.answers,
      recipientReference: record.recipientReference,
      provider: undefined,
      providerTransferId: undefined,
      providerStatus: undefined,
      fundingMethod: undefined,
      failureReason: undefined,
      createdAt: this.now(),
      updatedAt: this.now(),
      ...overrides,
    });
    if (this.failNextCreate) {
      this.failNextCreate = false;
      const winner = build({ reference: 'ALM-RACER' });
      this.transfers.set(winner.id, winner);
      return Promise.reject(new Error('duplicate key value violates unique constraint'));
    }
    if ([...this.transfers.values()].some((t) => t.quoteId === record.quoteId)) {
      return Promise.reject(new Error('duplicate key value violates transfers_one_per_quote'));
    }
    const transfer = build();
    this.transfers.set(transfer.id, transfer);
    this.events.set(transfer.id, [
      { status: 'DRAFT', source: 'SYSTEM', occurredAt: transfer.createdAt, applied: true },
    ]);
    return Promise.resolve(transfer);
  }
  attachProviderTransfer(id: string, provider: ProviderName, providerId: string): Promise<void> {
    const t = this.transfers.get(id);
    if (t) {
      t.provider = provider;
      t.providerTransferId = providerId;
    }
    return Promise.resolve();
  }
  recordFundingMethod(id: string, method: FundingMethod): Promise<void> {
    const t = this.transfers.get(id);
    if (t) {
      t.fundingMethod = method;
    }
    return Promise.resolve();
  }
  applyLocalStatusChange(id: string, change: LocalStatusChange): Promise<Transfer> {
    return this.#apply(
      id,
      change.status,
      false,
      undefined,
      change.failureReason,
      change.actor === 'user' ? 'USER' : 'SYSTEM',
    );
  }
  applyProviderStatus(id: string, evidence: ProviderStatusEvidence): Promise<Transfer> {
    const newest = this.providerStatusAt.get(id);
    if (
      evidence.source === 'provider_webhook' &&
      newest &&
      newest.getTime() > evidence.occurredAt.getTime()
    ) {
      return Promise.reject(new StaleProviderEventError());
    }
    const source = { provider_webhook: 'WEBHOOK', provider_lookup: 'POLL' }[
      evidence.source as string
    ];
    const applied = this.#apply(
      id,
      evidence.status,
      true,
      evidence.providerStatus,
      undefined,
      source ?? 'PROVIDER_RESPONSE',
    );
    if (evidence.source === 'provider_webhook') {
      return applied.then((transfer) => {
        this.providerStatusAt.set(id, evidence.occurredAt);
        return transfer;
      });
    }
    return applied;
  }
  recordIgnoredEvent(
    transferId: string,
    evidence: ProviderStatusEvidence,
    reason: string,
  ): Promise<void> {
    const current = this.transfers.get(transferId);
    const source = { provider_webhook: 'WEBHOOK', provider_lookup: 'POLL' }[
      evidence.source as string
    ];
    this.events.get(transferId)?.push({
      status: evidence.status,
      source: source ?? 'PROVIDER_RESPONSE',
      occurredAt: this.now(),
      applied: false,
      reason: `${reason}${current ? '' : ''}`,
    });
    return Promise.resolve();
  }
  listStuck(query: {
    provider: ProviderName;
    unchangedSince: Date;
    createdAfter: Date;
    notPolledSince: Date;
    limit: number;
  }): Promise<Transfer[]> {
    const lastChange = (t: Transfer): Date =>
      (this.events.get(t.id) ?? []).filter((e) => e.applied).at(-1)?.occurredAt ?? t.createdAt;
    return Promise.resolve(
      [...this.transfers.values()]
        .filter(
          (t) =>
            t.provider === query.provider &&
            t.providerTransferId !== undefined &&
            !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(t.status) &&
            t.createdAt.getTime() > query.createdAfter.getTime() &&
            lastChange(t).getTime() < query.unchangedSince.getTime() &&
            (!this.lastPolled.has(t.id) ||
              this.lastPolled.get(t.id)!.getTime() < query.notPolledSince.getTime()),
        )
        .slice(0, query.limit),
    );
  }
  listUnsubmitted(query: {
    provider: ProviderName;
    createdBefore: Date;
    createdAfter: Date;
    notPolledSince: Date;
    limit: number;
  }): Promise<Transfer[]> {
    return Promise.resolve(
      [...this.transfers.values()]
        .filter(
          (t) =>
            t.providerTransferId === undefined &&
            t.status === 'DRAFT' &&
            t.createdAt.getTime() < query.createdBefore.getTime() &&
            t.createdAt.getTime() > query.createdAfter.getTime() &&
            (!this.lastPolled.has(t.id) ||
              this.lastPolled.get(t.id)!.getTime() < query.notPolledSince.getTime()),
        )
        .slice(0, query.limit),
    );
  }
  countFailedSince(userId: string, since: Date): Promise<number> {
    return Promise.resolve(
      [...this.transfers.values()].filter(
        (t) =>
          t.userId === userId && t.status === 'FAILED' && t.updatedAt.getTime() >= since.getTime(),
      ).length,
    );
  }
  markPolled(transferId: string, at: Date): Promise<void> {
    this.lastPolled.set(transferId, at);
    return Promise.resolve();
  }
  #apply(
    id: string,
    status: Transfer['status'],
    hasEvidence: boolean,
    providerStatus: string | undefined,
    failureReason: string | undefined,
    source: string,
  ): Promise<Transfer> {
    const t = this.transfers.get(id);
    if (!t) {
      return Promise.reject(new Error(`transfer ${id} not found`));
    }
    if (t.status !== status) {
      const transition = findTransition(t.status, status);
      if (!transition || (transition.requiresProviderEvidence && !hasEvidence)) {
        return Promise.reject(new InvalidTransferTransitionError(t.status, status));
      }
      this.events.get(id)?.push({ status, source, occurredAt: this.now(), applied: true });
    }
    t.status = status;
    t.providerStatus = providerStatus ?? t.providerStatus;
    t.failureReason = failureReason ?? t.failureReason;
    t.updatedAt = new Date();
    return Promise.resolve(t);
  }
}

export interface FakeWebhookRow {
  id: string;
  provider: ProviderName;
  providerEventId: string;
  event: NormalisedEvent;
  redactedPayload: unknown;
  verified: boolean;
  result?: WebhookProcessingResult;
  note?: string;
  transferId?: string;
}

export class FakeWebhookEventRepository implements WebhookEventRepository {
  /** Every delivery, verified or not, in arrival order. */
  readonly rows: FakeWebhookRow[] = [];
  readonly unverified: { provider: ProviderName; bodySha256: string; bodyBytes: number }[] = [];

  recordUnverified(input: {
    provider: ProviderName;
    bodySha256: string;
    bodyBytes: number;
  }): Promise<void> {
    this.unverified.push(input);
    return Promise.resolve();
  }
  recordVerified(input: {
    provider: ProviderName;
    providerEventId: string;
    bodyHash: string;
    event: NormalisedEvent;
    redactedPayload: unknown;
  }): Promise<{ id: string; isNew: boolean; processed: boolean }> {
    const existing = this.rows.find(
      (r) => r.provider === input.provider && r.providerEventId === input.providerEventId,
    );
    if (existing) {
      return Promise.resolve({
        id: existing.id,
        isNew: false,
        processed: existing.result !== undefined,
      });
    }
    const row: FakeWebhookRow = {
      id: randomUUID(),
      provider: input.provider,
      providerEventId: input.providerEventId,
      event: input.event,
      redactedPayload: input.redactedPayload,
      verified: true,
    };
    this.rows.push(row);
    return Promise.resolve({ id: row.id, isNew: true, processed: false });
  }
  findById(id: string): Promise<StoredWebhookEvent | null> {
    const row = this.rows.find((r) => r.id === id);
    return Promise.resolve(
      row
        ? {
            id: row.id,
            provider: row.provider,
            providerEventId: row.providerEventId,
            event: { ...row.event, raw: row.redactedPayload },
            processed: row.result !== undefined,
          }
        : null,
    );
  }
  relateToTransfer(id: string, transferId: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.transferId = transferId;
    return Promise.resolve();
  }
  markProcessed(id: string, result: WebhookProcessingResult, note?: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.result === undefined) {
      row.result = result;
      if (note) row.note = note;
    }
    return Promise.resolve();
  }
}

export interface FakeJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  dedupeKey?: string | undefined;
  lastError?: string | undefined;
}

/** The job queue in memory, with the same rules as the database one. */
export class FakeJobQueue implements JobQueue {
  readonly jobs: FakeJob[] = [];
  /** Make the next `enqueue` fail, as if the database were down. */
  failNextEnqueue = false;

  enqueue(job: NewJob): Promise<{ id: string; created: boolean }> {
    if (this.failNextEnqueue) {
      this.failNextEnqueue = false;
      return Promise.reject(new Error('database unavailable'));
    }
    const existing = job.dedupeKey
      ? this.jobs.find((j) => j.dedupeKey === job.dedupeKey)
      : undefined;
    if (existing) {
      return Promise.resolve({ id: existing.id, created: false });
    }
    const created: FakeJob = {
      id: randomUUID(),
      type: job.type,
      payload: { ...(job.payload ?? {}) },
      status: 'queued',
      attempts: 0,
      maxAttempts: job.maxAttempts ?? 8,
      runAt: job.runAt ?? new Date(0),
      dedupeKey: job.dedupeKey,
    };
    this.jobs.push(created);
    return Promise.resolve({ id: created.id, created: true });
  }
  claim(_workerId: string, now: Date): Promise<Job | null> {
    const next = this.jobs
      .filter((j) => j.status === 'queued' && j.runAt.getTime() <= now.getTime())
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())[0];
    if (!next) return Promise.resolve(null);
    next.status = 'running';
    next.attempts += 1;
    return Promise.resolve({
      id: next.id,
      type: next.type,
      payload: next.payload,
      attempts: next.attempts,
      maxAttempts: next.maxAttempts,
    });
  }
  complete(id: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) job.status = 'done';
    return Promise.resolve();
  }
  fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) {
      job.lastError = error;
      job.status = retryAt ? 'queued' : 'dead';
      if (retryAt) job.runAt = retryAt;
    }
    return Promise.resolve();
  }
  releaseStale(): Promise<number> {
    return Promise.resolve(0);
  }
  prune(): Promise<number> {
    return Promise.resolve(0);
  }
  ofType(type: string): FakeJob[] {
    return this.jobs.filter((j) => j.type === type);
  }
}

export class FakeAdminAlerts implements AdminAlerts {
  readonly alerts: Mutable<AdminAlert>[] = [];
  raise(alert: NewAdminAlert): Promise<void> {
    const open = this.alerts.find(
      (a) =>
        a.status === 'open' &&
        a.kind === alert.kind &&
        a.entityType === alert.entityType &&
        a.entityId === alert.entityId,
    );
    if (open) {
      open.occurrences += 1;
      return Promise.resolve();
    }
    this.alerts.push({
      ...alert,
      id: randomUUID(),
      status: 'open',
      occurrences: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      resolvedAt: undefined,
    });
    return Promise.resolve();
  }
  list(filter: { status: 'open' | 'resolved' | 'all'; limit: number }): Promise<AdminAlert[]> {
    return Promise.resolve(
      this.alerts.filter((a) => filter.status === 'all' || a.status === filter.status),
    );
  }
  resolve(): Promise<boolean> {
    return Promise.resolve(false);
  }
  kinds(): string[] {
    return this.alerts.map((a) => a.kind);
  }
}

export class RecordingTransferMailer implements TransferMailer {
  readonly notices: { to: string; notice: TransferNotice }[] = [];
  /** Make the next send fail, as if the mail service were down. */
  failNext = false;
  sendTransferNotice(to: string, notice: TransferNotice): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail service unavailable'));
    }
    this.notices.push({ to, notice });
    return Promise.resolve();
  }
  kinds(): string[] {
    return this.notices.map((n) => n.notice.kind);
  }
}

export class FakeNotificationLog implements NotificationLog {
  readonly sent = new Set<string>();
  wasSent(transferId: string, kind: string): Promise<boolean> {
    return Promise.resolve(this.sent.has(`${transferId}:${kind}`));
  }
  markSent(transferId: string, _userId: string, kind: string): Promise<void> {
    this.sent.add(`${transferId}:${kind}`);
    return Promise.resolve();
  }
}

/** Ways a provider call can go wrong, for tests. */
export interface ProviderFaults {
  /** Reject the next N `createTransfer` calls with "no usable answer". */
  createTransferOutcomeUnknown?: number;
  /** Reject `fundTransfer` with "no usable answer". */
  fundingOutcomeUnknown?: boolean;
}

/**
 * Wraps a provider so a test can make specific calls fail, and records which
 * operations were called. Everything else passes straight through.
 */
export function faultyProvider(
  inner: PayoutProvider,
  faults: ProviderFaults = {},
): { provider: PayoutProvider; calls: string[]; faults: ProviderFaults } {
  const calls: string[] = [];
  const provider = new Proxy(inner, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value;
      }
      return (...args: unknown[]): unknown => {
        calls.push(property);
        if (property === 'createTransfer' && (faults.createTransferOutcomeUnknown ?? 0) > 0) {
          faults.createTransferOutcomeUnknown = (faults.createTransferOutcomeUnknown ?? 0) - 1;
          return Promise.reject(new ProviderUnavailableError(undefined, { outcomeUnknown: true }));
        }
        if (property === 'fundTransfer' && faults.fundingOutcomeUnknown) {
          return Promise.reject(new ProviderUnavailableError(undefined, { outcomeUnknown: true }));
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { provider, calls, faults };
}

export const USER = 'user-1';

/** A complete in-memory world around the mock provider, for use-case tests. */
export function buildWorld(
  options: {
    faults?: ProviderFaults;
    clock?: () => Date;
    mock?: MockPayoutProvider;
    limits?: Partial<{ perTransfer: string; perDay: string; perMonth: string }>;
  } = {},
) {
  const clock = options.clock ?? (() => new Date());
  const mock = options.mock ?? new MockPayoutProvider({ clock });
  const { provider, calls, faults } = faultyProvider(mock, options.faults);
  const currencyRegistry = new FakeCurrencyRegistry();
  const customerLinkStore = new FakeCustomerLinkStore();
  customerLinkStore.seed(USER);
  const currencyCatalogue = new CurrencyCatalogue({ provider, currencyRegistry, clock });
  const transferRepository = new FakeTransferRepository();
  transferRepository.now = clock;
  return {
    mock,
    provider,
    calls,
    faults,
    clock,
    currencyRegistry,
    currencyCatalogue,
    customerLinkStore,
    quoteRepository: new FakeQuoteRepository(),
    recipientRepository: new FakeRecipientRepository(),
    transferRepository,
    transferLimits: createTransferLimits({
      // Generous by default so only the limit tests ever hit them.
      config: {
        currency: 'GBP',
        perTransfer: '1000000',
        perDay: '10000000',
        perMonth: '100000000',
        ...options.limits,
      },
      currencyCatalogue,
      transferRepository,
      clock,
    }),
    webhookEventRepository: new FakeWebhookEventRepository(),
    jobQueue: new FakeJobQueue(),
    adminAlerts: new FakeAdminAlerts(),
    notificationLog: new FakeNotificationLog(),
    mailer: new RecordingTransferMailer(),
    auditLog: new RecordingAuditLog(),
  };
}

export type World = ReturnType<typeof buildWorld>;

export const EUR_RECIPIENT_VALUES = {
  legalType: 'PRIVATE',
  accountHolderName: 'Anna Schmidt',
  iban: 'DE89370400440532013000',
};

/** Both mail ports in one recording object, for tests that start the whole container. */
export class RecordingMailer extends RecordingTransferMailer {
  readonly accountEmails: string[] = [];
  sendEmailVerification(to: string): Promise<void> {
    this.accountEmails.push(`verify:${to}`);
    return Promise.resolve();
  }
  sendPasswordReset(to: string): Promise<void> {
    this.accountEmails.push(`reset:${to}`);
    return Promise.resolve();
  }
  sendPasswordChangedNotice(to: string): Promise<void> {
    this.accountEmails.push(`changed:${to}`);
    return Promise.resolve();
  }
  sendDuplicateRegistrationNotice(to: string): Promise<void> {
    this.accountEmails.push(`duplicate:${to}`);
    return Promise.resolve();
  }
}
