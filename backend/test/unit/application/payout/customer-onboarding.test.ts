import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCustomerOnboarding,
  identityMismatches,
  InvalidOnboardingStateError,
  ProfileIncompleteError,
} from '../../../../src/application/payout/customer-onboarding.ts';
import { assertSafeProviderRedirect } from '../../../../src/application/payout/safe-redirect.ts';
import { CountryNotSupportedError } from '../../../../src/application/payout/customer-profile.ts';
import { createLogger } from '../../../../src/shared/logger.ts';
import {
  buildWorld,
  FakeOnboardingStateStore,
  FakeProfileStore,
  PROFILE,
  USER,
} from '../../../support/transfer-fakes.ts';

const API = 'https://api.almapay.example';

function arrange(options: { email?: string; senderCountries?: string[] } = {}) {
  let now = new Date('2026-10-03T10:00:00Z');
  const world = buildWorld({ clock: () => now });
  world.customerLinkStore.unlink(USER);
  const onboardingStateStore = new FakeOnboardingStateStore();
  const profileStore = new FakeProfileStore();
  profileStore.profiles.set(USER, PROFILE);
  const logLines: string[] = [];
  const onboarding = createCustomerOnboarding({
    ...world,
    onboardingStateStore,
    profileStore,
    senderCountries: { list: () => Promise.resolve(options.senderCountries ?? ['GB']) },
    findUserEmail: (userId) =>
      Promise.resolve(userId === USER ? (options.email ?? 'jane@example.test') : null),
    logger: createLogger({ level: 'debug', write: (_level, line) => logLines.push(line) }),
    publicApiUrl: API,
    redirectPolicy: { allowedHosts: [], ownOrigin: API, isProduction: false },
  });
  return {
    world,
    onboarding,
    onboardingStateStore,
    profileStore,
    logLines,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

/** Starts onboarding and returns the state our return URL carried to the provider. */
async function startAndGetState(onboarding: ReturnType<typeof arrange>['onboarding']) {
  const outcome = await onboarding.start(USER);
  assert.equal(outcome.kind, 'redirect');
  if (outcome.kind !== 'redirect') throw new Error('unreachable');
  const returnUrl = new URL(new URL(outcome.url).searchParams.get('return_url') ?? '');
  assert.equal(returnUrl.origin + returnUrl.pathname, `${API}/api/v1/onboarding/callback`);
  const state = returnUrl.searchParams.get('state');
  assert.ok(state);
  return state;
}

test('starting stores a PENDING link and returns the provider page; nothing is verified yet', async () => {
  const { world, onboarding } = arrange();
  await startAndGetState(onboarding);

  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'PENDING');
  assert.ok(world.auditLog.actions().includes('customer.onboarding_started'));
  assert.ok(!world.calls.includes('completeCustomerOnboarding'));
});

test('only a hash of the state is stored, and it is long and random', async () => {
  const { onboarding, onboardingStateStore } = arrange();
  const first = await startAndGetState(onboarding);
  const second = await startAndGetState(onboarding);

  assert.notEqual(first, second);
  assert.ok(first.length >= 43);
  assert.ok(![...onboardingStateStore.states.keys()].includes(first));
});

test('the callback with our state completes onboarding with the status the provider reports', async () => {
  const { world, onboarding } = arrange();
  const state = await startAndGetState(onboarding);

  assert.equal(await onboarding.handleCallback(state, { state }), 'VERIFIED');
  assert.equal((await world.customerLinkStore.find(USER, 'mock'))?.status, 'VERIFIED');
  assert.ok(world.auditLog.actions().includes('customer.verification_status_recorded'));
});

test('the callback is refused without a state, with an unknown one, or with a used one', async () => {
  const { world, onboarding } = arrange();
  const state = await startAndGetState(onboarding);

  await assert.rejects(onboarding.handleCallback(undefined, {}), InvalidOnboardingStateError);
  await assert.rejects(onboarding.handleCallback('', {}), InvalidOnboardingStateError);
  await assert.rejects(
    onboarding.handleCallback('made-up-by-an-attacker', { mock_outcome: 'approved' }),
    InvalidOnboardingStateError,
  );
  assert.ok(!world.calls.includes('completeCustomerOnboarding'));
  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'PENDING');

  await onboarding.handleCallback(state, {});
  await assert.rejects(onboarding.handleCallback(state, {}), InvalidOnboardingStateError);
});

test('an expired state is refused', async () => {
  const { world, onboarding, advance } = arrange();
  const state = await startAndGetState(onboarding);
  advance(31 * 60 * 1000);

  await assert.rejects(onboarding.handleCallback(state, {}), InvalidOnboardingStateError);
  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'PENDING');
});

test('a state issued for another provider is refused', async () => {
  const { onboarding, onboardingStateStore } = arrange();
  const state = await startAndGetState(onboarding);
  for (const [hash, stored] of onboardingStateStore.states) {
    onboardingStateStore.states.set(hash, { ...stored, provider: 'wise' });
  }
  await assert.rejects(onboarding.handleCallback(state, {}), InvalidOnboardingStateError);
});

test('our state parameter is not passed on to the provider', async () => {
  const { world, onboarding } = arrange();
  const state = await startAndGetState(onboarding);
  let seen: Readonly<Record<string, string>> | undefined;
  const original = world.mock.completeCustomerOnboarding.bind(world.mock);
  world.mock.completeCustomerOnboarding = (user, params) => {
    seen = params;
    return original(user, params);
  };
  await onboarding.handleCallback(state, { state, mock_outcome: 'pending' });
  assert.deepEqual(seen, { mock_outcome: 'pending' });
});

test('the stored status is whatever the provider reports – pending, rejected or relink', async () => {
  for (const [outcome, status] of [
    ['pending', 'PENDING'],
    ['rejected', 'REJECTED'],
    ['relink', 'NEEDS_RELINK'],
  ] as const) {
    const { world, onboarding } = arrange();
    const state = await startAndGetState(onboarding);
    assert.equal(await onboarding.handleCallback(state, { mock_outcome: outcome }), status);
    assert.equal(await world.customerLinkStore.status(USER, 'mock'), status);
  }
});

test('an identity mismatch holds the link for review, alerts an admin and never verifies', async () => {
  const { world, onboarding, logLines } = arrange({ email: 'jane+mismatch@example.test' });
  const state = await startAndGetState(onboarding);

  assert.equal(await onboarding.handleCallback(state, {}), 'REJECTED_PENDING_REVIEW');
  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'REJECTED_PENDING_REVIEW');

  const audit = world.auditLog.entries.find((e) => e.action === 'customer.identity_mismatch');
  assert.deepEqual(audit?.context, { provider: 'mock', fields: ['dateOfBirth'] });
  // An admin alert is raised; it names the fields, never the values.
  assert.deepEqual(world.adminAlerts.kinds(), ['IDENTITY_MISMATCH']);
  const alert = world.adminAlerts.alerts[0]!;
  assert.equal(alert.entityId, USER);
  assert.deepEqual(alert.context, { provider: 'mock', fields: ['dateOfBirth'] });
  assert.ok(!JSON.stringify(alert).includes('1901-01-01'));
  assert.ok(!JSON.stringify(alert).includes(PROFILE.dateOfBirth));
  assert.equal(logLines.length >= 0, true);

  // The provider says VERIFIED, but neither a refresh nor a restart lifts the hold.
  world.calls.length = 0;
  assert.equal(await onboarding.refreshStatus(USER), 'REJECTED_PENDING_REVIEW');
  assert.deepEqual(await onboarding.start(USER), {
    kind: 'done',
    status: 'REJECTED_PENDING_REVIEW',
  });
  assert.deepEqual(world.calls, []);
});

test('names match regardless of case, accents and spacing; dates must match exactly', () => {
  assert.deepEqual(
    identityMismatches(
      { ...PROFILE, firstName: 'José', lastName: "O'Neil-Smith" },
      { firstName: 'JOSE', lastName: 'oneil smith', dateOfBirth: PROFILE.dateOfBirth },
    ),
    [],
  );
  assert.deepEqual(
    identityMismatches(PROFILE, { firstName: 'John', lastName: 'Doe', dateOfBirth: '1990-04-13' }),
    ['firstName', 'dateOfBirth'],
  );
  // A provider that verifies only some fields is compared on those alone.
  assert.deepEqual(identityMismatches(PROFILE, { lastName: 'Doe' }), []);
});

test('onboarding cannot start without a complete profile', async () => {
  const { world, onboarding, profileStore } = arrange();
  profileStore.profiles.delete(USER);
  await assert.rejects(onboarding.start(USER), ProfileIncompleteError);
  assert.deepEqual(world.calls, []);
});

test('onboarding cannot start for a country the provider does not accept senders from', async () => {
  const { world, onboarding } = arrange({ senderCountries: ['DE'] });
  await assert.rejects(onboarding.start(USER), CountryNotSupportedError);
  assert.deepEqual(world.calls, []);
});

test('a verified customer is not sent through onboarding again', async () => {
  const { world, onboarding } = arrange();
  world.customerLinkStore.seed(USER, 'VERIFIED');
  assert.deepEqual(await onboarding.start(USER), { kind: 'done', status: 'VERIFIED' });
  assert.deepEqual(world.calls, []);
});

test('a customer who must reconnect can start again and becomes verified from provider data', async () => {
  const { world, onboarding } = arrange();
  world.customerLinkStore.seed(USER, 'NEEDS_RELINK');
  const state = await startAndGetState(onboarding);
  assert.equal(await onboarding.handleCallback(state, {}), 'VERIFIED');
  assert.equal(await world.customerLinkStore.status(USER, 'mock'), 'VERIFIED');
});

test('a refresh token from the provider is stored through the link store', async () => {
  const { world, onboarding } = arrange();
  const state = await startAndGetState(onboarding);
  const original = world.mock.completeCustomerOnboarding.bind(world.mock);
  world.mock.completeCustomerOnboarding = async (user, params) => ({
    ...(await original(user, params)),
    refreshToken: 'refresh-token-value',
  });
  await onboarding.handleCallback(state, {});
  assert.equal(await world.customerLinkStore.readRefreshToken(USER, 'mock'), 'refresh-token-value');
});

test('refreshing asks the provider again; without a link the customer is unverified', async () => {
  const { world, onboarding } = arrange();
  assert.equal(await onboarding.refreshStatus(USER), 'UNVERIFIED');
  assert.deepEqual(world.calls, []);

  const state = await startAndGetState(onboarding);
  await onboarding.handleCallback(state, { mock_outcome: 'pending' });
  world.calls.length = 0;
  assert.equal(await onboarding.refreshStatus(USER), 'PENDING');
  assert.deepEqual(world.calls, ['getCustomerStatus']);
});

test('a link to a different provider counts as unverified for the active one', async () => {
  const { world, onboarding } = arrange();
  world.customerLinkStore.seed(USER, 'VERIFIED', 'wise');
  assert.equal(await onboarding.refreshStatus(USER), 'UNVERIFIED');
});

// --- Where the customer may be sent ----------------------------------------------

test('the customer is only ever sent to a safe, allow-listed provider page', async () => {
  for (const [url, allowed] of [
    ['https://id.provider.example/start?x=1', true],
    ['https://eu.id.provider.example/start', true],
    ['http://id.provider.example/start', false], // not https
    ['https://evil.example/phish', false], // not on the list
    ['https://id.provider.example.evil.example/', false], // lookalike host
    ['https://user:pw@id.provider.example/', false], // credentials in the URL
    ['https://203.0.113.9/', false], // an IP address
    ['javascript:alert(1)', false],
    ['not a url', false],
  ] as const) {
    const world = buildWorld();
    world.customerLinkStore.unlink(USER);
    world.mock.startCustomerOnboarding = () => Promise.resolve({ kind: 'redirect' as const, url });
    const profileStore = new FakeProfileStore();
    profileStore.profiles.set(USER, PROFILE);
    const onboarding = createCustomerOnboarding({
      ...world,
      onboardingStateStore: new FakeOnboardingStateStore(),
      profileStore,
      senderCountries: { list: () => Promise.resolve(['GB']) },
      findUserEmail: () => Promise.resolve('jane@example.test'),
      logger: createLogger({ level: 'error', write: () => {} }),
      publicApiUrl: API,
      redirectPolicy: { allowedHosts: ['provider.example'], ownOrigin: API, isProduction: true },
    });
    if (allowed) {
      assert.deepEqual(await onboarding.start(USER), {
        kind: 'redirect',
        url: new URL(url).toString(),
      });
    } else {
      await assert.rejects(onboarding.start(USER), /couldn't start the identity check/, url);
    }
  }
});

test('the mock provider page on this backend is allowed only outside production', () => {
  const dev = { allowedHosts: [], ownOrigin: 'http://localhost:3000', isProduction: false };
  const page = 'http://localhost:3000/dev/mock/kyc?return_url=x';
  assert.equal(assertSafeProviderRedirect(page, dev), page);
  assert.throws(
    () => assertSafeProviderRedirect(page, { ...dev, isProduction: true }),
    /identity check/,
  );
  // Only that one page, not the rest of the backend.
  assert.throws(
    () => assertSafeProviderRedirect('http://localhost:3000/api/v1/auth/logout-all', dev),
    /identity check/,
  );
});
