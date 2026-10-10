import { createHash, randomBytes } from 'node:crypto';

/**
 * High-entropy opaque tokens (refresh tokens, email-verification and
 * password-reset links).
 *
 * The raw token is 256 bits of randomness, so it is stored and looked up by a
 * plain SHA-256 hash — a slow password hash (argon2) is unnecessary for a value
 * that cannot be brute-forced. The raw token is shown to the user exactly once.
 */

const DEFAULT_BYTES = 32;

export interface SecretToken {
  readonly raw: string;
  readonly hash: string;
}

export function generateSecretToken(byteLength: number = DEFAULT_BYTES): SecretToken {
  const raw = randomBytes(byteLength).toString('base64url');
  return { raw, hash: hashSecretToken(raw) };
}

export function hashSecretToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
