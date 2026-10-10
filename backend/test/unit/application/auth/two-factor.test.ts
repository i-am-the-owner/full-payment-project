import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTwoFactor,
  TotpRequiredError,
  TotpUnavailableError,
  hashRecoveryCode,
  type RecoveryCodeStore,
  type TotpState,
  type TotpStore,
} from '../../../../src/application/auth/two-factor.ts';
import {
  generateTotpSecret,
  totpCode,
  totpCounter,
  totpUri,
  verifyTotp,
} from '../../../../src/infrastructure/auth/totp.ts';
import { ValidationError } from '../../../../src/shared/errors.ts';
import { FakeAuditLog } from '../../../support/auth-fakes.ts';

class FakeTotpStore implements TotpStore {
  available = true;
  secret: string | null = null;
  enabled = false;
  lastCounter = -1;
  get(): Promise<TotpState> {
    return Promise.resolve({ secret: this.secret, enabled: this.enabled });
  }
  savePendingSecret(_userId: string, secret: string): Promise<void> {
    this.secret = secret;
    this.enabled = false;
    return Promise.resolve();
  }
  enable(): Promise<void> {
    this.enabled = true;
    return Promise.resolve();
  }
  disable(): Promise<void> {
    this.secret = null;
    this.enabled = false;
    return Promise.resolve();
  }
  consumeCounter(_userId: string, counter: number): Promise<boolean> {
    if (counter <= this.lastCounter) return Promise.resolve(false);
    this.lastCounter = counter;
    return Promise.resolve(true);
  }
}

class FakeRecoveryStore implements RecoveryCodeStore {
  codes = new Map<string, boolean>(); // hash -> used
  replaceAll(_u: string, hashes: readonly string[]): Promise<void> {
    this.codes = new Map(hashes.map((h) => [h, false]));
    return Promise.resolve();
  }
  consume(_u: string, hash: string): Promise<boolean> {
    if (this.codes.get(hash) !== false) return Promise.resolve(false);
    this.codes.set(hash, true);
    return Promise.resolve(true);
  }
  remaining(): Promise<number> {
    return Promise.resolve([...this.codes.values()].filter((used) => !used).length);
  }
  deleteAll(): Promise<void> {
    this.codes.clear();
    return Promise.resolve();
  }
}

function arrange() {
  let now = new Date('2026-10-03T10:00:00Z');
  const totpStore = new FakeTotpStore();
  const auditLog = new FakeAuditLog();
  const recoveryStore = new FakeRecoveryStore();
  const twoFactor = createTwoFactor({
    totpStore,
    recoveryCodes: recoveryStore,
    totp: { generateSecret: generateTotpSecret, verify: verifyTotp, uri: totpUri },
    findUserEmail: () => Promise.resolve('jane@example.test'),
    auditLog,
    clock: () => now,
    issuer: 'SomPay',
  });
  return {
    twoFactor,
    recoveryStore,
    totpStore,
    auditLog,
    code: (offsetSteps = 0) => totpCode(totpStore.secret ?? '', totpCounter(now) + offsetSteps),
    advance: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

test('without two-step sign-in, login needs no code', async () => {
  const { twoFactor } = arrange();
  assert.equal(await twoFactor.checkAtLogin('u', undefined), true);
});

test('set-up alone changes nothing; it is on only after a correct code', async () => {
  const { twoFactor, totpStore, auditLog, code, advance } = arrange();
  const { secret, otpauthUri } = await twoFactor.setup('u');
  assert.ok(otpauthUri.includes(secret));
  assert.equal(await twoFactor.checkAtLogin('u', undefined), true);

  await assert.rejects(twoFactor.enable('u', '000000'), ValidationError);
  assert.equal(totpStore.enabled, false);

  await twoFactor.enable('u', code());
  assert.equal(totpStore.enabled, true);
  assert.ok(auditLog.actions().includes('auth.two_factor.enabled'));

  await assert.rejects(twoFactor.checkAtLogin('u', undefined), TotpRequiredError);
  assert.equal(await twoFactor.checkAtLogin('u', '000000'), false);
  advance(30);
  assert.equal(await twoFactor.checkAtLogin('u', code()), true);
});

test('a code cannot be used twice', async () => {
  const { twoFactor, code, advance } = arrange();
  await twoFactor.setup('u');
  await twoFactor.enable('u', code());
  advance(30);
  const once = code();
  assert.equal(await twoFactor.checkAtLogin('u', once), true);
  assert.equal(await twoFactor.checkAtLogin('u', once), false);
});

test('turning it off needs a valid code', async () => {
  const { twoFactor, totpStore, code, advance } = arrange();
  await twoFactor.setup('u');
  await twoFactor.enable('u', code());
  await assert.rejects(twoFactor.disable('u', '000000'), ValidationError);
  assert.equal(totpStore.enabled, true);
  advance(30);
  await twoFactor.disable('u', code());
  assert.equal(totpStore.enabled, false);
  assert.equal(await twoFactor.checkAtLogin('u', undefined), true);
});

test('set-up is refused while already on, and when secrets cannot be encrypted', async () => {
  const { twoFactor, totpStore, code } = arrange();
  await twoFactor.setup('u');
  await twoFactor.enable('u', code());
  await assert.rejects(twoFactor.setup('u'), ValidationError);

  const other = arrange();
  other.totpStore.available = false;
  await assert.rejects(other.twoFactor.setup('u'), TotpUnavailableError);
  assert.equal(totpStore.enabled, true);
});

test('enabling shows ten recovery codes once; only hashes are stored', async () => {
  const { twoFactor, recoveryStore, code, auditLog } = arrange();
  await twoFactor.setup('u');
  const { recoveryCodes } = await twoFactor.enable('u', code());
  assert.equal(recoveryCodes.length, 10);
  assert.equal(new Set(recoveryCodes).size, 10);
  for (const c of recoveryCodes) {
    assert.match(c, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.ok(recoveryStore.codes.has(hashRecoveryCode(c)));
    assert.ok(![...recoveryStore.codes.keys()].some((stored) => stored.includes(c)));
  }
  assert.equal(await recoveryStore.remaining(), 10);
  assert.ok(auditLog.entries.every((e) => !JSON.stringify(e).includes(recoveryCodes[0]!)));
});

test('a recovery code signs in once, however it is typed, and a wrong one does not', async () => {
  const { twoFactor, code, recoveryStore, auditLog } = arrange();
  await twoFactor.setup('u');
  const { recoveryCodes } = await twoFactor.enable('u', code());
  const first = recoveryCodes[0]!;

  assert.equal(await twoFactor.checkAtLogin('u', undefined, 'AAAA-BBBB-CCCC-DDDD'), false);
  assert.equal(
    await twoFactor.checkAtLogin('u', undefined, first.toLowerCase().replaceAll('-', ' ')),
    true,
  );
  assert.equal(await twoFactor.checkAtLogin('u', undefined, first), false, 'one time only');
  assert.equal(await recoveryStore.remaining(), 9);
  assert.ok(auditLog.entries.some((e) => e.action === 'auth.two_factor.recovery_code_used'));
});

test('regenerating needs a current code and retires the old set; disabling removes them', async () => {
  const { twoFactor, code, advance, recoveryStore } = arrange();
  await twoFactor.setup('u');
  const old = (await twoFactor.enable('u', code())).recoveryCodes;

  await assert.rejects(twoFactor.regenerateRecoveryCodes('u', '000000'), ValidationError);
  advance(90);
  const fresh = (await twoFactor.regenerateRecoveryCodes('u', code())).recoveryCodes;
  assert.equal(await twoFactor.checkAtLogin('u', undefined, old[0]), false);
  assert.equal(await twoFactor.checkAtLogin('u', undefined, fresh[0]), true);

  advance(90);
  await twoFactor.disable('u', code());
  assert.equal(recoveryStore.codes.size, 0);
});

test('verifyCode accepts a right code once (step-up) and refuses when 2FA is off', async () => {
  const { twoFactor, code, advance } = arrange();
  assert.equal(await twoFactor.verifyCode('u', '123456'), false);
  await twoFactor.setup('u');
  await twoFactor.enable('u', code());
  advance(60);
  assert.equal(await twoFactor.verifyCode('u', code()), true);
  assert.equal(
    await twoFactor.verifyCode('u', code()),
    false,
    'the same code cannot be used twice',
  );
});
