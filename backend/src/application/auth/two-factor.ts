import { createHash, randomBytes } from 'node:crypto';
import { AppError, ValidationError } from '../../shared/errors.ts';
import type { AuditLog } from '../audit/audit-log.ts';

/** Two-factor authentication cannot be offered: no encryption key is configured. */
export class TotpUnavailableError extends AppError {
  constructor() {
    super('TOTP_UNAVAILABLE', 503, 'Two-step sign-in is not available right now.');
  }
}

/** Sign-in needs the 6-digit code from the customer's authenticator app. */
export class TotpRequiredError extends AppError {
  constructor() {
    super('TOTP_REQUIRED', 401, 'Enter the 6-digit code from your authenticator app.');
  }
}

export interface TotpState {
  /** The decrypted secret, or null if none has been set up. */
  readonly secret: string | null;
  readonly enabled: boolean;
}

/** Storage for TOTP secrets (encrypted at rest) and replay protection. */
export interface TotpStore {
  /** False when secrets cannot be encrypted (no key configured). */
  readonly available: boolean;
  get(userId: string): Promise<TotpState>;
  /** Stores a new, not-yet-enabled secret, replacing any earlier pending one. */
  savePendingSecret(userId: string, secret: string): Promise<void>;
  enable(userId: string): Promise<void>;
  disable(userId: string): Promise<void>;
  /** Records a time step as used. False if that step (or a later one) was already used. */
  consumeCounter(userId: string, counter: number): Promise<boolean>;
}

/** Pure TOTP functions, injected so the use cases stay free of crypto details. */
export interface TotpAlgorithm {
  generateSecret(): string;
  verify(secret: string, code: string, now: Date): number | null;
  uri(secret: string, account: string, issuer: string): string;
}

/** One-time recovery codes for a customer who has lost their authenticator. */
export interface RecoveryCodeStore {
  /** Replaces every code the user has (used or not) with these hashes. */
  replaceAll(userId: string, hashes: readonly string[]): Promise<void>;
  /** Marks one unused code used. False if it does not exist or was already used. */
  consume(userId: string, hash: string): Promise<boolean>;
  remaining(userId: string): Promise<number>;
  deleteAll(userId: string): Promise<void>;
}

export const RECOVERY_CODE_COUNT = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_GROUPS = 4;
const CODE_GROUP_LENGTH = 4; // 16 characters from 32 symbols = 80 bits

/** Uppercases and drops spaces and dashes, so a typed code matches however it was grouped. */
export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/** 80 bits of randomness, so an unsalted SHA-256 of the code cannot be guessed offline. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(`almapay-recovery:${normaliseRecoveryCode(code)}`)
    .digest('hex');
}

function generateRecoveryCode(): string {
  const bytes = randomBytes(CODE_GROUPS * CODE_GROUP_LENGTH);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += CODE_GROUP_LENGTH) {
    groups.push(chars.slice(i, i + CODE_GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}

export interface TwoFactorDeps {
  readonly recoveryCodes: RecoveryCodeStore;
  readonly totpStore: TotpStore;
  readonly totp: TotpAlgorithm;
  readonly findUserEmail: (userId: string) => Promise<string | null>;
  readonly auditLog: AuditLog;
  readonly clock: () => Date;
  readonly issuer: string;
}

export interface TwoFactor {
  /** Starts set-up: returns the secret to add to an authenticator app. Not yet enabled. */
  setup(userId: string): Promise<{ secret: string; otpauthUri: string }>;
  /**
   * Turns two-step sign-in on once the customer proves the app works. Returns
   * the recovery codes: this is the only time they are shown.
   */
  enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }>;
  /** New recovery codes (the old ones stop working). Needs a current authenticator code. */
  regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }>;
  /** True if `code` is a correct, unused authenticator code right now (consumes it). For step-up checks. */
  verifyCode(userId: string, code: string): Promise<boolean>;
  disable(userId: string, code: string): Promise<void>;
  /**
   * Checks a sign-in code. Returns true when the account has no two-step
   * sign-in. Throws {@link TotpRequiredError} when a code is needed but absent.
   */
  checkAtLogin(userId: string, code: string | undefined, recoveryCode?: string): Promise<boolean>;
}

const WRONG_CODE = 'That code is not right. Check your authenticator app and try again.';

export function createTwoFactor(deps: TwoFactorDeps): TwoFactor {
  const verifyOnce = async (userId: string, secret: string, code: string): Promise<boolean> => {
    const counter = deps.totp.verify(secret, code, deps.clock());
    return counter !== null && (await deps.totpStore.consumeCounter(userId, counter));
  };

  const audit = (userId: string, action: string): Promise<void> =>
    deps.auditLog.record({
      actorType: 'user',
      actorId: userId,
      action,
      entityType: 'user',
      entityId: userId,
    });

  const issueRecoveryCodes = async (userId: string): Promise<string[]> => {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await deps.recoveryCodes.replaceAll(userId, codes.map(hashRecoveryCode));
    return codes;
  };

  return {
    async setup(userId) {
      if (!deps.totpStore.available) {
        throw new TotpUnavailableError();
      }
      const state = await deps.totpStore.get(userId);
      if (state.enabled) {
        throw new ValidationError(
          'Two-step sign-in is already on. Turn it off first to set it up again.',
        );
      }
      const secret = deps.totp.generateSecret();
      await deps.totpStore.savePendingSecret(userId, secret);
      const email = (await deps.findUserEmail(userId)) ?? 'account';
      return { secret, otpauthUri: deps.totp.uri(secret, email, deps.issuer) };
    },

    async enable(userId, code) {
      const state = await deps.totpStore.get(userId);
      if (!state.secret || state.enabled) {
        throw new ValidationError('Start two-step sign-in set-up first.');
      }
      if (!(await verifyOnce(userId, state.secret, code))) {
        throw new ValidationError(WRONG_CODE, [{ field: 'body.code', message: 'Incorrect code' }]);
      }
      await deps.totpStore.enable(userId);
      await audit(userId, 'auth.two_factor.enabled');
      return { recoveryCodes: await issueRecoveryCodes(userId) };
    },

    async regenerateRecoveryCodes(userId, code) {
      const state = await deps.totpStore.get(userId);
      if (!state.secret || !state.enabled) {
        throw new ValidationError('Two-step sign-in is not on.');
      }
      if (!(await verifyOnce(userId, state.secret, code))) {
        throw new ValidationError(WRONG_CODE, [{ field: 'body.code', message: 'Incorrect code' }]);
      }
      const recoveryCodes = await issueRecoveryCodes(userId);
      await audit(userId, 'auth.two_factor.recovery_codes_regenerated');
      return { recoveryCodes };
    },

    async verifyCode(userId, code) {
      const state = await deps.totpStore.get(userId);
      return Boolean(
        state.secret && state.enabled && (await verifyOnce(userId, state.secret, code)),
      );
    },

    async disable(userId, code) {
      const state = await deps.totpStore.get(userId);
      if (!state.secret || !state.enabled) {
        return;
      }
      if (!(await verifyOnce(userId, state.secret, code))) {
        throw new ValidationError(WRONG_CODE, [{ field: 'body.code', message: 'Incorrect code' }]);
      }
      await deps.totpStore.disable(userId);
      await deps.recoveryCodes.deleteAll(userId);
      await audit(userId, 'auth.two_factor.disabled');
    },

    async checkAtLogin(userId, code, recoveryCode) {
      if (!deps.totpStore.available) {
        return true;
      }
      const state = await deps.totpStore.get(userId);
      if (!state.enabled || !state.secret) {
        return true;
      }
      if (recoveryCode) {
        const ok = await deps.recoveryCodes.consume(userId, hashRecoveryCode(recoveryCode));
        if (ok) {
          await audit(userId, 'auth.two_factor.recovery_code_used');
        }
        return ok;
      }
      if (!code) {
        throw new TotpRequiredError();
      }
      return verifyOnce(userId, state.secret, code);
    },
  };
}
