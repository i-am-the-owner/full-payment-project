import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Application-level encryption for provider tokens at rest (AES-256-GCM).
 *
 * - The key comes from the environment / secret manager (`ENCRYPTION_KEY`),
 *   never from code, and is never logged.
 * - Every ciphertext records the version of the key that produced it, so the
 *   key can be rotated: new values use the current key, old values stay
 *   readable while their key is still configured.
 * - `context` is bound into the ciphertext as additional authenticated data
 *   (e.g. which row it belongs to). A value copied into another row, or
 *   tampered with, fails to decrypt.
 *
 * Stored format: base64( iv[12] | authTag[16] | ciphertext ).
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedValue {
  readonly ciphertext: string;
  readonly keyVersion: number;
}

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCipherError';
  }
}

export interface TokenCipherConfig {
  /** The version new values are encrypted with. */
  readonly currentVersion: number;
  /** Every usable key by version; must include `currentVersion`. */
  readonly keys: ReadonlyMap<number, Buffer>;
}

export class TokenCipher {
  readonly #currentVersion: number;
  readonly #keys: ReadonlyMap<number, Buffer>;

  constructor(config: TokenCipherConfig) {
    for (const [version, key] of config.keys) {
      if (!Number.isInteger(version) || version <= 0) {
        throw new TokenCipherError(`Invalid encryption key version: ${version}`);
      }
      if (key.length !== KEY_BYTES) {
        throw new TokenCipherError(`Encryption key version ${version} must be ${KEY_BYTES} bytes`);
      }
    }
    if (!config.keys.has(config.currentVersion)) {
      throw new TokenCipherError(
        `No encryption key is configured for the current version ${config.currentVersion}`,
      );
    }
    this.#currentVersion = config.currentVersion;
    this.#keys = new Map(config.keys);
  }

  get currentVersion(): number {
    return this.#currentVersion;
  }

  encrypt(plaintext: string, context: string): EncryptedValue {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key(this.#currentVersion), iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'),
      keyVersion: this.#currentVersion,
    };
  }

  /** @throws {TokenCipherError} if the key is unknown or the value was altered. */
  decrypt(value: EncryptedValue, context: string): string {
    const raw = Buffer.from(value.ciphertext, 'base64');
    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new TokenCipherError('The encrypted value is malformed');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.#key(value.keyVersion),
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    try {
      return Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Deliberately vague: never echo ciphertext, plaintext or key material.
      throw new TokenCipherError('The encrypted value could not be decrypted');
    }
  }

  /** True when a value was encrypted with a key older than the current one. */
  needsRotation(value: EncryptedValue): boolean {
    return value.keyVersion !== this.#currentVersion;
  }

  #key(version: number): Buffer {
    const key = this.#keys.get(version);
    if (!key) {
      throw new TokenCipherError(`No encryption key is configured for version ${version}`);
    }
    return key;
  }
}

function decodeKey(encoded: string, label: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new TokenCipherError(`${label} must be ${KEY_BYTES} random bytes, base64-encoded`);
  }
  return key;
}

/**
 * Builds the cipher from environment values.
 *
 *   ENCRYPTION_KEY            base64 of 32 random bytes – the current key
 *   ENCRYPTION_KEY_VERSION    its version (default 1)
 *   ENCRYPTION_PREVIOUS_KEYS  older keys still needed to read existing values,
 *                             as `version:base64,version:base64`
 *
 * To rotate: move the current key into ENCRYPTION_PREVIOUS_KEYS under its
 * version, set a new ENCRYPTION_KEY and increase ENCRYPTION_KEY_VERSION.
 *
 * Returns `null` when no key is configured: nothing can then be encrypted, and
 * callers must refuse to store a token rather than store it in the clear.
 */
export function loadTokenCipher(env: {
  ENCRYPTION_KEY?: string | undefined;
  ENCRYPTION_KEY_VERSION: number;
  ENCRYPTION_PREVIOUS_KEYS?: string | undefined;
}): TokenCipher | null {
  if (!env.ENCRYPTION_KEY) {
    if (env.ENCRYPTION_PREVIOUS_KEYS) {
      throw new TokenCipherError('ENCRYPTION_PREVIOUS_KEYS is set but ENCRYPTION_KEY is not');
    }
    return null;
  }
  const keys = new Map<number, Buffer>();
  for (const entry of (env.ENCRYPTION_PREVIOUS_KEYS ?? '').split(',')) {
    if (entry.trim() === '') {
      continue;
    }
    const separator = entry.indexOf(':');
    const version = Number(entry.slice(0, separator).trim());
    if (separator <= 0 || !Number.isInteger(version) || version <= 0) {
      throw new TokenCipherError('ENCRYPTION_PREVIOUS_KEYS must look like "1:<base64>,2:<base64>"');
    }
    if (version === env.ENCRYPTION_KEY_VERSION || keys.has(version)) {
      throw new TokenCipherError(`ENCRYPTION_PREVIOUS_KEYS repeats key version ${version}`);
    }
    keys.set(version, decodeKey(entry.slice(separator + 1).trim(), `Previous key ${version}`));
  }
  keys.set(env.ENCRYPTION_KEY_VERSION, decodeKey(env.ENCRYPTION_KEY, 'ENCRYPTION_KEY'));
  return new TokenCipher({ currentVersion: env.ENCRYPTION_KEY_VERSION, keys });
}
