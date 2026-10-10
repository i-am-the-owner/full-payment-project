import { AppError, ValidationError, type FieldError } from '../../shared/errors.ts';
import { NotImplementedError } from '../../domain/payout/errors.ts';
import type { CustomerProfile } from '../../domain/payout/models.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { ProfileStore } from '../transfer/ports.ts';
import type { CurrencyCatalogue } from './currency-catalogue.ts';

const MIN_AGE_YEARS = 18;
const MAX_AGE_YEARS = 120;
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,99}$/u;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The provider does not accept senders who live in this country. */
export class CountryNotSupportedError extends AppError {
  constructor() {
    super(
      'COUNTRY_NOT_SUPPORTED',
      422,
      "Sorry, we can't offer transfers to people living in that country yet.",
      [{ field: 'body.countryOfResidence', message: 'Country not supported yet' }],
    );
  }
}

export interface SenderCountries {
  /** Countries whose residents may sign up, from the provider or configuration. */
  list(): Promise<readonly string[]>;
}

/**
 * The provider's own list when it gives one; otherwise the configured list.
 * A provider that has no capabilities yet falls back to configuration too.
 */
export function createSenderCountries(deps: {
  currencyCatalogue: CurrencyCatalogue;
  configured: readonly string[];
}): SenderCountries {
  return {
    async list() {
      try {
        const { capabilities } = await deps.currencyCatalogue.get();
        return capabilities.senderCountries ?? deps.configured;
      } catch (error) {
        if (error instanceof NotImplementedError) {
          return deps.configured;
        }
        throw error;
      }
    },
  };
}

function ageOn(dateOfBirth: Date, today: Date): number {
  const age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() < dateOfBirth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

/** Validates and normalises a profile. Throws {@link ValidationError} with field errors. */
export function validateProfile(input: CustomerProfile, today: Date): CustomerProfile {
  const problems: FieldError[] = [];
  const firstName = input.firstName.trim().replace(/\s+/g, ' ');
  const lastName = input.lastName.trim().replace(/\s+/g, ' ');
  const phone = input.phone.replace(/[\s()-]/g, '');
  const country = input.countryOfResidence.trim().toUpperCase();

  if (!NAME_PATTERN.test(firstName)) {
    problems.push({ field: 'body.firstName', message: 'Enter your first name' });
  }
  if (!NAME_PATTERN.test(lastName)) {
    problems.push({ field: 'body.lastName', message: 'Enter your last name' });
  }
  if (!E164_PATTERN.test(phone)) {
    problems.push({
      field: 'body.phone',
      message: 'Enter your phone number with the country code, for example +447700900123',
    });
  }
  if (!COUNTRY_PATTERN.test(country)) {
    problems.push({ field: 'body.countryOfResidence', message: 'Choose your country' });
  }

  const match = DATE_PATTERN.exec(input.dateOfBirth.trim());
  const born = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : undefined;
  const isRealDate =
    born !== undefined &&
    match !== null &&
    born.getUTCFullYear() === Number(match[1]) &&
    born.getUTCMonth() === Number(match[2]) - 1 &&
    born.getUTCDate() === Number(match[3]);
  if (!born || !isRealDate) {
    problems.push({ field: 'body.dateOfBirth', message: 'Enter your date of birth' });
  } else {
    const age = ageOn(born, today);
    if (age < MIN_AGE_YEARS) {
      problems.push({
        field: 'body.dateOfBirth',
        message: 'You must be 18 or over to use SomPay',
      });
    } else if (age > MAX_AGE_YEARS) {
      problems.push({ field: 'body.dateOfBirth', message: 'Check your date of birth' });
    }
  }

  if (problems.length > 0) {
    throw new ValidationError('Please check the highlighted details.', problems);
  }
  return {
    firstName,
    lastName,
    dateOfBirth: input.dateOfBirth.trim(),
    countryOfResidence: country,
    phone,
  };
}

export function isCompleteProfile(profile: Partial<CustomerProfile>): profile is CustomerProfile {
  return Boolean(
    profile.firstName &&
    profile.lastName &&
    profile.dateOfBirth &&
    profile.countryOfResidence &&
    profile.phone,
  );
}

export interface CustomerProfiles {
  get(userId: string): Promise<Partial<CustomerProfile>>;
  update(userId: string, profile: CustomerProfile): Promise<CustomerProfile>;
}

/**
 * The profile step of sign-up. A customer who lives somewhere the provider does
 * not accept senders is told so here, before any identity check starts.
 */
export function createCustomerProfiles(deps: {
  profileStore: ProfileStore;
  senderCountries: SenderCountries;
  auditLog: AuditLog;
  clock: () => Date;
}): CustomerProfiles {
  return {
    get: (userId) => deps.profileStore.get(userId),
    async update(userId, input) {
      const profile = validateProfile(input, deps.clock());
      if (!(await deps.senderCountries.list()).includes(profile.countryOfResidence)) {
        throw new CountryNotSupportedError();
      }
      await deps.profileStore.save(userId, profile);
      // The audit trail records that the profile changed, never its contents.
      await deps.auditLog.record({
        actorType: 'user',
        actorId: userId,
        action: 'customer.profile_updated',
        entityType: 'user',
        entityId: userId,
        context: { countryOfResidence: profile.countryOfResidence },
      });
      return profile;
    },
  };
}
