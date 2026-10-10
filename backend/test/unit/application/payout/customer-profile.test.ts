import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CountryNotSupportedError,
  createCustomerProfiles,
  createSenderCountries,
  isCompleteProfile,
  validateProfile,
} from '../../../../src/application/payout/customer-profile.ts';
import { NotImplementedError } from '../../../../src/domain/payout/errors.ts';
import type { CurrencyCatalogue } from '../../../../src/application/payout/currency-catalogue.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import {
  buildWorld,
  FakeProfileStore,
  PROFILE,
  RecordingAuditLog,
  USER,
} from '../../../support/transfer-fakes.ts';

const TODAY = new Date('2026-10-03T12:00:00Z');

function fieldsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    return (error.fieldErrors ?? []).map((e) => e.field);
  }
  throw new Error('expected a validation error');
}

test('a valid profile is trimmed and normalised', () => {
  assert.deepEqual(
    validateProfile(
      {
        firstName: '  Mary   Ann ',
        lastName: "O'Neil-Smith",
        dateOfBirth: '1990-04-12',
        countryOfResidence: 'gb',
        phone: '+44 (7700) 900-123',
      },
      TODAY,
    ),
    {
      firstName: 'Mary Ann',
      lastName: "O'Neil-Smith",
      dateOfBirth: '1990-04-12',
      countryOfResidence: 'GB',
      phone: '+447700900123',
    },
  );
});

test('every bad field is reported at once', () => {
  assert.deepEqual(
    fieldsOf(() =>
      validateProfile(
        {
          firstName: '',
          lastName: '1234',
          dateOfBirth: 'yesterday',
          countryOfResidence: 'United Kingdom',
          phone: '07700900123',
        },
        TODAY,
      ),
    ),
    [
      'body.firstName',
      'body.lastName',
      'body.phone',
      'body.countryOfResidence',
      'body.dateOfBirth',
    ],
  );
});

test('the date of birth must be a real date, 18 or over, and plausible', () => {
  const dob = (dateOfBirth: string) => () => validateProfile({ ...PROFILE, dateOfBirth }, TODAY);
  assert.deepEqual(fieldsOf(dob('1990-02-30')), ['body.dateOfBirth']);
  assert.deepEqual(fieldsOf(dob('2008-10-04')), ['body.dateOfBirth']); // 18 tomorrow
  assert.deepEqual(fieldsOf(dob('1850-01-01')), ['body.dateOfBirth']);
  assert.equal(dob('2008-10-03')().dateOfBirth, '2008-10-03'); // 18 today
});

test('a profile is complete only with every field', () => {
  assert.equal(isCompleteProfile(PROFILE), true);
  assert.equal(isCompleteProfile({ ...PROFILE, phone: '' }), false);
  assert.equal(isCompleteProfile({}), false);
});

function arrange(countries: string[]) {
  const profileStore = new FakeProfileStore();
  const auditLog = new RecordingAuditLog();
  const profiles = createCustomerProfiles({
    profileStore,
    senderCountries: { list: () => Promise.resolve(countries) },
    auditLog,
    clock: () => TODAY,
  });
  return { profiles, profileStore, auditLog };
}

test('saving a profile stores it and audits the change without the personal details', async () => {
  const { profiles, profileStore, auditLog } = arrange(['GB']);
  await profiles.update(USER, PROFILE);
  assert.deepEqual(profileStore.profiles.get(USER), PROFILE);
  assert.deepEqual(auditLog.entries[0]?.context, { countryOfResidence: 'GB' });
});

test('a country the provider does not accept senders from is refused with a friendly message', async () => {
  const { profiles, profileStore } = arrange(['GB']);
  await assert.rejects(
    profiles.update(USER, { ...PROFILE, countryOfResidence: 'US' }),
    (error: unknown) =>
      error instanceof CountryNotSupportedError &&
      error.httpStatus === 422 &&
      /can't offer transfers to people living in that country yet/.test(error.message),
  );
  assert.equal(profileStore.profiles.size, 0);
});

test('sender countries come from the provider, falling back to configuration', async () => {
  const world = buildWorld();
  const fromProvider = createSenderCountries({
    currencyCatalogue: world.currencyCatalogue,
    configured: ['FR'],
  });
  assert.deepEqual(await fromProvider.list(), ['GB']);

  const noList = createSenderCountries({
    currencyCatalogue: {
      get: () => Promise.resolve({ capabilities: {} }),
    } as unknown as CurrencyCatalogue,
    configured: ['FR'],
  });
  assert.deepEqual(await noList.list(), ['FR']);

  const notBuilt = createSenderCountries({
    currencyCatalogue: {
      get: () => Promise.reject(new NotImplementedError('wise', 'getCapabilities')),
    } as unknown as CurrencyCatalogue,
    configured: ['FR'],
  });
  assert.deepEqual(await notBuilt.list(), ['FR']);
});
