import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../../application/auth/password-hasher.ts';

/**
 * Argon2id password hasher.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation
 * (m = 19 MiB, t = 2, p = 1). Argon2id is `@node-rs/argon2`'s default algorithm.
 * The parameters are stated explicitly so `needsRehash` can detect stored hashes
 * that predate a future parameter change.
 */
const PARAMS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(plainText: string): Promise<string> {
    return hash(plainText.normalize('NFKC'), PARAMS);
  }

  async verify(storedHash: string, plainText: string): Promise<boolean> {
    try {
      return await verify(storedHash, plainText.normalize('NFKC'), PARAMS);
    } catch {
      // Malformed stored hash – treat as a failed verification, never throw.
      return false;
    }
  }

  needsRehash(storedHash: string): boolean {
    const match = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
    if (!match) {
      return true;
    }
    const [, memory, time, parallelism] = match;
    return (
      Number(memory) < PARAMS.memoryCost ||
      Number(time) < PARAMS.timeCost ||
      Number(parallelism) !== PARAMS.parallelism
    );
  }
}
