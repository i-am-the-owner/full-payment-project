/** Hashes and verifies user passwords. Plaintext passwords are never stored. */
export interface PasswordHasher {
  hash(plainText: string): Promise<string>;
  /** Constant-time verification. Returns false for a malformed stored hash. */
  verify(storedHash: string, plainText: string): Promise<boolean>;
  /** True if the stored hash uses outdated parameters and should be re-hashed on next login. */
  needsRehash(storedHash: string): boolean;
}
