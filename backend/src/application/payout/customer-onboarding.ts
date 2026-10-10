import { createHash, randomBytes } from 'node:crypto';
import { AppError, UnauthorizedError } from '../../shared/errors.ts';
import { CustomerNotVerifiedError, NeedsRelinkError } from '../../domain/payout/errors.ts';
import type {
  CustomerProfile,
  OnboardingUser,
  ProviderCustomerLink,
  VerifiedIdentity,
} from '../../domain/payout/models.ts';
import type { Logger } from '../../shared/logger.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { AdminAlerts } from '../notifications/admin-alerts.ts';
import type {
  CustomerLinkStore,
  OnboardingStateStore,
  ProfileStore,
  StoredCustomerStatus,
} from '../transfer/ports.ts';
import {
  CountryNotSupportedError,
  isCompleteProfile,
  type SenderCountries,
} from './customer-profile.ts';
import type { PayoutProvider } from './payout-provider.ts';
import { assertSafeProviderRedirect, type RedirectPolicy } from './safe-redirect.ts';

const STATE_TTL_MS = 30 * 60 * 1000;

/** The profile step must be finished before the identity check can start. */
export class ProfileIncompleteError extends AppError {
  constructor() {
    super(
      'PROFILE_INCOMPLETE',
      409,
      'Please complete your profile before verifying your identity.',
    );
  }
}

/** The provider's redirect carried no state, or one that is unknown, expired or already used. */
export class InvalidOnboardingStateError extends AppError {
  constructor() {
    super(
      'INVALID_ONBOARDING_STATE',
      400,
      'This verification link is no longer valid. Please start the identity check again from the app.',
    );
  }
}

export interface OnboardingDeps {
  readonly provider: PayoutProvider;
  readonly customerLinkStore: CustomerLinkStore;
  readonly onboardingStateStore: OnboardingStateStore;
  readonly profileStore: ProfileStore;
  readonly senderCountries: SenderCountries;
  /** Looks up the email of an active account; null if it does not exist. */
  readonly findUserEmail: (userId: string) => Promise<string | null>;
  /** Tells the customer the outcome of the provider's identity check. Best effort. */
  readonly notifyIdCheck?:
    | ((email: string, result: 'verified' | 'needs_review' | 'rejected') => Promise<void>)
    | undefined;
  readonly auditLog: AuditLog;
  /** Where an identity mismatch is reported for a person to review. */
  readonly adminAlerts?: AdminAlerts | undefined;
  readonly logger: Logger;
  readonly clock: () => Date;
  /** This backend's public base URL, used to build the provider's return URL. */
  readonly publicApiUrl: string;
  /** Where a provider may send the customer. Anything else is refused. */
  readonly redirectPolicy: RedirectPolicy;
}

export type OnboardingOutcome =
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'done'; readonly status: StoredCustomerStatus };

export interface CustomerOnboarding {
  /** Begins (or restarts, after NEEDS_RELINK) the provider's identity check. */
  start(userId: string): Promise<OnboardingOutcome>;
  /** Handles the provider's redirect back to us. `state` proves which customer it is for. */
  handleCallback(
    state: string | undefined,
    callbackParams: Readonly<Record<string, string>>,
  ): Promise<StoredCustomerStatus>;
  /** Asks the provider for the customer's current status and stores it. */
  refreshStatus(userId: string): Promise<StoredCustomerStatus>;
}

/** The host of a URL for the log, or a marker if it is not a URL. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '(invalid)';
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** Names compare equal regardless of case, accents, spacing and punctuation. */
function normaliseName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
}

/** The profile fields that disagree with what the provider verified. */
export function identityMismatches(profile: CustomerProfile, verified: VerifiedIdentity): string[] {
  const fields: string[] = [];
  if (
    verified.firstName !== undefined &&
    normaliseName(verified.firstName) !== normaliseName(profile.firstName)
  ) {
    fields.push('firstName');
  }
  if (
    verified.lastName !== undefined &&
    normaliseName(verified.lastName) !== normaliseName(profile.lastName)
  ) {
    fields.push('lastName');
  }
  if (verified.dateOfBirth !== undefined && verified.dateOfBirth !== profile.dateOfBirth) {
    fields.push('dateOfBirth');
  }
  return fields;
}

/**
 * Customer verification is run by the provider. These use cases are the only
 * writers of a customer's verification status. A customer becomes VERIFIED only
 * when `getCustomerStatus` says so; SomPay can withhold that (an identity
 * mismatch) but can never grant it, and nothing a customer sends can set it.
 */
export function createCustomerOnboarding(deps: OnboardingDeps): CustomerOnboarding {
  const providerName = deps.provider.name;

  const loadUser = async (
    userId: string,
  ): Promise<OnboardingUser & { profile: CustomerProfile }> => {
    const email = await deps.findUserEmail(userId);
    if (!email) {
      throw new UnauthorizedError('The account for this request no longer exists.');
    }
    const profile = await deps.profileStore.get(userId);
    if (!isCompleteProfile(profile)) {
      throw new ProfileIncompleteError();
    }
    return { id: userId, email, profile };
  };

  const sync = async (
    userId: string,
    link: ProviderCustomerLink,
  ): Promise<StoredCustomerStatus> => {
    const reported = await deps.provider.getCustomerStatus(link);
    await deps.customerLinkStore.recordProviderStatus(userId, link.provider, reported);
    // Read back: a link held for review keeps that status whatever was reported.
    const stored = (await deps.customerLinkStore.status(userId, link.provider)) ?? reported;
    await deps.auditLog.record({
      actorType: 'provider',
      action: 'customer.verification_status_recorded',
      entityType: 'user',
      entityId: userId,
      context: { provider: link.provider, reported, stored },
    });
    return stored;
  };

  const complete = async (
    user: OnboardingUser & { profile: CustomerProfile },
    callbackParams: Readonly<Record<string, string>>,
  ): Promise<StoredCustomerStatus> => {
    const status = await completeInner(user, callbackParams);
    await tellCustomer(user.id, status);
    return status;
  };

  /** Emails the customer when the identity check reached a decision. Never blocks or fails onboarding. */
  const tellCustomer = async (userId: string, status: StoredCustomerStatus): Promise<void> => {
    const result =
      status === 'VERIFIED'
        ? 'verified'
        : status === 'REJECTED_PENDING_REVIEW'
          ? 'needs_review'
          : status === 'REJECTED'
            ? 'rejected'
            : null;
    if (!result || !deps.notifyIdCheck) return;
    try {
      const email = await deps.findUserEmail(userId);
      if (email) await deps.notifyIdCheck(email, result);
    } catch (error) {
      deps.logger.warn('onboarding.id_check_email_failed', { error });
    }
  };

  const completeInner = async (
    user: OnboardingUser & { profile: CustomerProfile },
    callbackParams: Readonly<Record<string, string>>,
  ): Promise<StoredCustomerStatus> => {
    const completed = await deps.provider.completeCustomerOnboarding(user, callbackParams);
    await deps.customerLinkStore.saveLink(user.id, completed.link);
    if (completed.refreshToken) {
      await deps.customerLinkStore.saveRefreshToken(
        user.id,
        completed.link.provider,
        completed.refreshToken,
      );
    }

    if (completed.verifiedIdentity) {
      const fields = identityMismatches(user.profile, completed.verifiedIdentity);
      if (fields.length > 0) {
        await deps.customerLinkStore.flagIdentityMismatch(user.id, completed.link.provider);
        // Which fields differ, never their values.
        await deps.auditLog.record({
          actorType: 'system',
          action: 'customer.identity_mismatch',
          entityType: 'user',
          entityId: user.id,
          context: { provider: completed.link.provider, fields },
        });
        if (deps.adminAlerts) {
          // Raising the alert also logs it (field names only, never values).
          await deps.adminAlerts.raise({
            kind: 'IDENTITY_MISMATCH',
            severity: 'high',
            entityType: 'user',
            entityId: user.id,
            message:
              `The identity verified by ${completed.link.provider} does not match the profile ` +
              `the customer gave us. Sending is blocked until someone has reviewed it.`,
            context: { provider: completed.link.provider, fields },
          });
        } else {
          deps.logger.error('admin.alert.identity_mismatch', {
            userId: user.id,
            provider: completed.link.provider,
            fields,
          });
        }
        return 'REJECTED_PENDING_REVIEW';
      }
    }
    // The provider-verified identity matched (or there was nothing to compare):
    // only now may a status of VERIFIED be accepted for this link.
    await deps.customerLinkStore.markIdentityChecked(user.id, completed.link.provider);
    return sync(user.id, completed.link);
  };

  return {
    async start(userId) {
      const user = await loadUser(userId);
      if (!(await deps.senderCountries.list()).includes(user.profile.countryOfResidence)) {
        throw new CountryNotSupportedError();
      }
      const current = await deps.customerLinkStore.status(userId, providerName);
      if (current === 'VERIFIED' || current === 'REJECTED_PENDING_REVIEW') {
        return { kind: 'done', status: current };
      }

      const state = randomBytes(32).toString('base64url');
      await deps.onboardingStateStore.create({
        userId,
        provider: providerName,
        stateHash: hashState(state),
        expiresAt: new Date(deps.clock().getTime() + STATE_TTL_MS),
      });
      const returnUrl = new URL('/api/v1/onboarding/callback', deps.publicApiUrl);
      returnUrl.searchParams.set('state', state);

      const started = await deps.provider.startCustomerOnboarding(user, {
        returnUrl: returnUrl.toString(),
      });
      await deps.customerLinkStore.beginLink(userId, providerName);
      await deps.auditLog.record({
        actorType: 'user',
        actorId: userId,
        action: 'customer.onboarding_started',
        entityType: 'user',
        entityId: userId,
        context: { provider: providerName, kind: started.kind },
      });

      if (started.kind === 'redirect') {
        if (started.link) {
          await deps.customerLinkStore.saveLink(userId, started.link);
        }
        let url: string;
        try {
          url = assertSafeProviderRedirect(started.url, deps.redirectPolicy);
        } catch (error) {
          deps.logger.error('onboarding.redirect.rejected', {
            provider: providerName,
            host: safeHost(started.url),
          });
          throw error;
        }
        return { kind: 'redirect', url };
      }
      return { kind: 'done', status: await complete(user, {}) };
    },

    async handleCallback(state, callbackParams) {
      if (!state) {
        throw new InvalidOnboardingStateError();
      }
      const owner = await deps.onboardingStateStore.consume(hashState(state), deps.clock());
      if (!owner || owner.provider !== providerName) {
        throw new InvalidOnboardingStateError();
      }
      // Our own parameter is not the provider's business.
      const { state: _state, ...providerParams } = callbackParams;
      void _state;
      return complete(await loadUser(owner.userId), providerParams);
    },

    async refreshStatus(userId) {
      const stored = await deps.customerLinkStore.status(userId, providerName);
      if (stored === null) {
        return 'UNVERIFIED';
      }
      const record = await deps.customerLinkStore.find(userId, providerName);
      if (!record || stored === 'REJECTED_PENDING_REVIEW') {
        return stored;
      }
      return sync(userId, record.link);
    },
  };
}

/**
 * The customer's link to the active provider, or a typed error. Reads the
 * stored, provider-reported status; it does not call the provider.
 */
export async function requireVerifiedLink(
  deps: { provider: PayoutProvider; customerLinkStore: CustomerLinkStore },
  userId: string,
): Promise<ProviderCustomerLink> {
  const record = await deps.customerLinkStore.find(userId, deps.provider.name);
  if (!record) {
    throw new CustomerNotVerifiedError();
  }
  if (record.status === 'NEEDS_RELINK') {
    throw new NeedsRelinkError();
  }
  if (record.status !== 'VERIFIED') {
    throw new CustomerNotVerifiedError();
  }
  return record.link;
}
