import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createDatabasePool,
  type DatabasePool,
} from '../../../src/infrastructure/database/pool.ts';
import { loadMigrations, migrate } from '../../../src/infrastructure/database/migrator.ts';
import { PostgresCustomerLinkStore } from '../../../src/infrastructure/database/postgres-customer-link-store.ts';
import { TokenCipher } from '../../../src/infrastructure/crypto/token-cipher.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const suite = DATABASE_URL ? test : test.skip;

const KEY_1 = randomBytes(32);
const KEY_2 = randomBytes(32);
const TOKEN = 'provider-refresh-token-4f1c9a';

let pool: DatabasePool;
let userId: string;

const cipherV1 = new TokenCipher({ currentVersion: 1, keys: new Map([[1, KEY_1]]) });
const cipherV2 = new TokenCipher({
  currentVersion: 2,
  keys: new Map([
    [1, KEY_1],
    [2, KEY_2],
  ]),
});

before(async () => {
  if (!DATABASE_URL) return;
  pool = createDatabasePool(DATABASE_URL);
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR), { info: () => {} });
});
after(async () => {
  if (pool) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(`TRUNCATE users RESTART IDENTITY CASCADE`);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('link-store@example.test') RETURNING id`,
  );
  userId = rows[0]!.id;
});

async function storedRow(): Promise<{
  encrypted_refresh_token: string | null;
  token_key_version: number | null;
  kyc_status: string;
}> {
  const { rows } = await pool.query<{
    encrypted_refresh_token: string | null;
    token_key_version: number | null;
    kyc_status: string;
  }>(
    `SELECT encrypted_refresh_token, token_key_version, kyc_status FROM provider_links WHERE user_id = $1`,
    [userId],
  );
  return rows[0]!;
}

suite('a new link is PENDING until the provider reports a status', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  assert.equal(await store.find(userId, 'mock'), null);

  await store.saveLink(userId, {
    provider: 'mock',
    customerRef: 'cust-1',
    profileRef: 'profile-9',
  });
  assert.deepEqual(await store.find(userId, 'mock'), {
    link: { provider: 'mock', customerRef: 'cust-1', profileRef: 'profile-9' },
    status: 'PENDING',
  });

  await store.markIdentityChecked(userId, 'mock');
  await store.recordProviderStatus(userId, 'mock', 'VERIFIED');
  assert.equal((await store.find(userId, 'mock'))?.status, 'VERIFIED');
  // A link to another provider is separate.
  assert.equal(await store.find(userId, 'wise'), null);
});

suite('saving the same link again keeps its status; a different customer resets it', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await store.markIdentityChecked(userId, 'mock');
  await store.recordProviderStatus(userId, 'mock', 'VERIFIED');
  await store.saveRefreshToken(userId, 'mock', TOKEN);

  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  assert.equal((await store.find(userId, 'mock'))?.status, 'VERIFIED');
  assert.equal(await store.readRefreshToken(userId, 'mock'), TOKEN);

  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-2' });
  assert.equal((await store.find(userId, 'mock'))?.status, 'PENDING');
  assert.equal(await store.readRefreshToken(userId, 'mock'), null);
});

suite('a refresh token is encrypted at rest and never stored in the clear', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await store.saveRefreshToken(userId, 'mock', TOKEN);

  const row = await storedRow();
  assert.equal(row.token_key_version, 1);
  assert.ok(row.encrypted_refresh_token);
  assert.equal(row.encrypted_refresh_token.includes(TOKEN), false);
  const dump = await pool.query(`SELECT * FROM provider_links`);
  assert.equal(JSON.stringify(dump.rows).includes(TOKEN), false);

  assert.equal(await store.readRefreshToken(userId, 'mock'), TOKEN);
});

suite(
  'after key rotation an old token is still readable and is re-encrypted with the new key',
  async () => {
    await new PostgresCustomerLinkStore(pool, cipherV1).saveLink(userId, {
      provider: 'mock',
      customerRef: 'cust-1',
    });
    await new PostgresCustomerLinkStore(pool, cipherV1).saveRefreshToken(userId, 'mock', TOKEN);
    const before = await storedRow();

    const rotated = new PostgresCustomerLinkStore(pool, cipherV2);
    assert.equal(await rotated.readRefreshToken(userId, 'mock'), TOKEN);

    const after = await storedRow();
    assert.equal(after.token_key_version, 2);
    assert.notEqual(after.encrypted_refresh_token, before.encrypted_refresh_token);
    // The retired key is no longer needed.
    const onlyNewKey = new PostgresCustomerLinkStore(
      pool,
      new TokenCipher({ currentVersion: 2, keys: new Map([[2, KEY_2]]) }),
    );
    assert.equal(await onlyNewKey.readRefreshToken(userId, 'mock'), TOKEN);
  },
);

suite('a ciphertext copied onto another user’s link does not decrypt', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await store.saveRefreshToken(userId, 'mock', TOKEN);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('thief@example.test') RETURNING id`,
  );
  const thief = rows[0]!.id;
  await store.saveLink(thief, { provider: 'mock', customerRef: 'cust-thief' });
  await pool.query(
    `UPDATE provider_links t SET encrypted_refresh_token = v.encrypted_refresh_token,
            token_key_version = v.token_key_version
     FROM provider_links v WHERE v.user_id = $1 AND t.user_id = $2`,
    [userId, thief],
  );
  await assert.rejects(store.readRefreshToken(thief, 'mock'), /could not be decrypted/);
});

suite('without an encryption key a token is refused, never stored in the clear', async () => {
  const store = new PostgresCustomerLinkStore(pool, null);
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await assert.rejects(
    store.saveRefreshToken(userId, 'mock', TOKEN),
    /ENCRYPTION_KEY is not configured/,
  );
  assert.equal((await storedRow()).encrypted_refresh_token, null);
  // Linking and status still work without a key.
  await store.markIdentityChecked(userId, 'mock');
  await store.recordProviderStatus(userId, 'mock', 'VERIFIED');
  assert.equal((await store.find(userId, 'mock'))?.status, 'VERIFIED');
});

suite('a token cannot be stored for a provider the customer is not linked to', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await assert.rejects(store.saveRefreshToken(userId, 'wise', TOKEN), /no link to that provider/);
});

suite('deleting a user removes their provider links and stored tokens', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await store.saveRefreshToken(userId, 'mock', TOKEN);

  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  const { rows } = await pool.query(`SELECT 1 FROM provider_links`);
  assert.equal(rows.length, 0);
});

suite('onboarding starts with a PENDING link that has no provider customer yet', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await store.beginLink(userId, 'mock');
  assert.equal(await store.status(userId, 'mock'), 'PENDING');
  // Nothing can be sent with it: there is no customer to send as.
  assert.equal(await store.find(userId, 'mock'), null);

  // Starting again never downgrades or duplicates an existing link.
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await store.markIdentityChecked(userId, 'mock');
  await store.recordProviderStatus(userId, 'mock', 'VERIFIED');
  await store.beginLink(userId, 'mock');
  assert.equal(await store.status(userId, 'mock'), 'VERIFIED');
  const { rows } = await pool.query(`SELECT 1 FROM provider_links WHERE user_id = $1`, [userId]);
  assert.equal(rows.length, 1);
});

suite('a link held for an identity mismatch ignores later provider statuses', async () => {
  const store = new PostgresCustomerLinkStore(pool, cipherV1);
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  await store.flagIdentityMismatch(userId, 'mock');
  assert.equal(await store.status(userId, 'mock'), 'REJECTED_PENDING_REVIEW');

  await store.markIdentityChecked(userId, 'mock');
  await store.recordProviderStatus(userId, 'mock', 'VERIFIED');
  assert.equal(await store.status(userId, 'mock'), 'REJECTED_PENDING_REVIEW');
  // Saving the same customer again does not reset the hold either.
  await store.saveLink(userId, { provider: 'mock', customerRef: 'cust-1' });
  assert.equal(await store.status(userId, 'mock'), 'REJECTED_PENDING_REVIEW');
});

suite(
  'a failed provider token marks that customer NEEDS_RELINK, and only that customer',
  async () => {
    const store = new PostgresCustomerLinkStore(pool, cipherV1);
    const other = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ('other@example.test') RETURNING id`,
    );
    const otherId = other.rows[0]!.id;
    for (const [id, ref] of [
      [userId, 'cust-1'],
      [otherId, 'cust-2'],
    ] as const) {
      await store.saveLink(id, { provider: 'mock', customerRef: ref });
      await store.markIdentityChecked(id, 'mock');
      await store.recordProviderStatus(id, 'mock', 'VERIFIED');
    }

    await store.markNeedsRelink('mock', 'cust-1');
    assert.equal(await store.status(userId, 'mock'), 'NEEDS_RELINK');
    assert.equal(await store.status(otherId, 'mock'), 'VERIFIED');
  },
);
