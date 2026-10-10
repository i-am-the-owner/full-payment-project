/**
 * Password strength policy.
 *
 * Deliberately simple and NIST-aligned: length is the primary control, plus a
 * check for trivially weak inputs. It does not impose composition rules
 * (upper/lower/digit/symbol), which push users toward predictable patterns.
 * A breached-password check (e.g. HIBP range API) is a documented future
 * enhancement.
 */

const MAX_LENGTH = 128;

// A very small denylist of passwords that are weak regardless of length.
const OBVIOUS_WEAK = new Set([
  'password',
  'passw0rd',
  'password123',
  'letmein',
  'qwertyuiop',
  'iloveyou',
  '111111111111',
  '123456789012',
  'administrator',
  'almapay',
  'sompay',
]);

export interface PasswordPolicy {
  readonly minLength: number;
}

export interface PasswordEvaluation {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export function evaluatePassword(password: string, policy: PasswordPolicy): PasswordEvaluation {
  const problems: string[] = [];
  const normalised = password.normalize('NFKC');

  if (normalised.length < policy.minLength) {
    problems.push(`Must be at least ${policy.minLength} characters.`);
  }
  if (normalised.length > MAX_LENGTH) {
    problems.push(`Must be at most ${MAX_LENGTH} characters.`);
  }
  if (/^(.)\1+$/.test(normalised)) {
    problems.push('Must not be a single repeated character.');
  }
  if (OBVIOUS_WEAK.has(normalised.toLowerCase())) {
    problems.push('This password is too common.');
  }

  return { ok: problems.length === 0, problems };
}
