import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { createContainer, type Container } from '../../../src/container.ts';
import type { Mailer } from '../../../src/application/auth/mailer.ts';
import type { TransferMailer } from '../../../src/application/notifications/ports.ts';
import type { PayoutProvider } from '../../../src/application/payout/payout-provider.ts';
import { createApp } from '../../../src/interfaces/http/create-app.ts';
import { loadMigrations, migrate } from '../../../src/infrastructure/database/migrator.ts';
import type { Role } from '../../../src/domain/auth/principal.ts';
import type { IssuedTokens } from '../../../src/domain/auth/session.ts';

export const DATABASE_URL = process.env.DATABASE_URL;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const TEST_JWT_SECRET = 'integration-test-secret-integration-1';

function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL,
    JWT_SECRET: TEST_JWT_SECRET,
    // Generous by default so a full test file does not exhaust the shared
    // in-memory rate limiter. Rate-limit tests set their own low limits.
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    ...overrides,
  };
}

export interface HttpResult {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface TestUser {
  id: string;
  email: string;
}

export interface TestContext {
  container: Container;
  baseUrl: string;
  /** Structured log lines captured from the container's logger. */
  logLines: string[];
  reset(): Promise<void>;
  close(): Promise<void>;
  http(path: string, init?: RequestInit): Promise<HttpResult>;
  /** Creates a real session and returns its access + refresh tokens. */
  createSession(userId: string, roles?: readonly Role[]): Promise<IssuedTokens>;
  /** Convenience: just the access token. */
  issueToken(userId: string, roles?: readonly Role[]): Promise<string>;
  createExpiredToken(userId: string): Promise<string>;
  createUser(options?: {
    status?: string;
    emailVerified?: boolean;
    /** Simulates the payout provider's KYC decision. Defaults to verified. */
    providerVerified?: boolean;
    /** A specific stored link status; overrides `providerVerified`. */
    kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NEEDS_RELINK' | 'REJECTED_PENDING_REVIEW';
    /** Fill in the profile step. Defaults to true. */
    withProfile?: boolean;
  }): Promise<TestUser>;
  countRows(table: string, where?: string): Promise<number>;
}

export interface TestContextOptions {
  envOverrides?: Record<string, string>;
  /** Skip running migrations (for tests that deliberately use an unreachable DB). */
  skipMigrations?: boolean;
  /** Replace the payout provider, e.g. with one that injects failures. */
  payoutProvider?: PayoutProvider;
  /** Replace the mailer, to read what customers were sent. */
  mailer?: Mailer & TransferMailer;
}

/**
 * What a real admin has in the database: the role, and two-step sign-in turned
 * on. Tests that want to prove the gate refuses someone call `startSession`
 * directly instead.
 */
async function grantStaffAccess(
  container: Container,
  userId: string,
  roles: readonly Role[],
): Promise<void> {
  for (const role of roles.filter((r) => r === 'admin' || r === 'support')) {
    await container.pool.query(
      `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, 'test')
       ON CONFLICT DO NOTHING`,
      [userId, role],
    );
    await container.pool.query(
      `UPDATE user_auth
       SET totp_secret_encrypted = 'test-not-a-real-secret', totp_key_version = 1,
           totp_enabled_at = now()
       WHERE user_id = $1`,
      [userId],
    );
  }
}

export async function startTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const logLines: string[] = [];
  const container = createContainer(testEnv(options.envOverrides), {
    logWrite: (_level, line) => logLines.push(line),
    ...(options.payoutProvider ? { payoutProvider: options.payoutProvider } : {}),
    ...(options.mailer ? { mailer: options.mailer } : {}),
  });
  if (!options.skipMigrations) {
    await migrate(container.pool, await loadMigrations(MIGRATIONS_DIR), { info: () => {} });
  }

  // Rate-limit counters live in the shared database, so start each context from zero.
  if (!options.skipMigrations) {
    await container.pool.query('TRUNCATE rate_limit_hits');
  }
  const app = createApp(container);
  const server: Server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const secret = new TextEncoder().encode(TEST_JWT_SECRET);

  return {
    container,
    baseUrl,
    logLines,

    async reset() {
      await container.pool.query(`TRUNCATE users RESTART IDENTITY CASCADE`);
      await container.pool.query('TRUNCATE rate_limit_hits');
    },

    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await container.shutdown();
    },

    async http(path, init) {
      const response = await fetch(`${baseUrl}${path}`, init);
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        body: text.length > 0 ? (JSON.parse(text) as unknown) : null,
      };
    },

    async createSession(userId, roles = ['customer']) {
      await grantStaffAccess(container, userId, roles);
      return container.sessionService.startSession({ userId, roles, emailVerified: true });
    },

    async issueToken(userId, roles = ['customer']) {
      await grantStaffAccess(container, userId, roles);
      const tokens = await container.sessionService.startSession({
        userId,
        roles,
        emailVerified: true,
      });
      return tokens.accessToken;
    },

    createExpiredToken(userId) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ roles: ['customer'], sid: randomUUID(), email_verified: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer('almapay')
        .setAudience('almapay-mobile')
        .setIssuedAt(now - 120)
        .setExpirationTime(now - 60)
        .setJti(randomUUID())
        .sign(secret);
    },

    async createUser(options) {
      const email = `user-${randomUUID()}@example.test`;
      const withProfile = options?.withProfile ?? true;
      const { rows } = await container.pool.query<{ id: string }>(
        `INSERT INTO users (email, status, email_verified_at,
                            first_name, last_name, date_of_birth, country_of_residence, phone)
         VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          email,
          options?.status ?? 'active',
          options?.emailVerified ?? true,
          ...(withProfile
            ? ['Jane', 'Doe', '1990-04-12', 'GB', '+447700900123']
            : [null, null, null, null, null]),
        ],
      );
      const id = rows[0]!.id;
      const kycStatus =
        options?.kycStatus ?? ((options?.providerVerified ?? true) ? 'VERIFIED' : undefined);
      if (kycStatus) {
        // What provider onboarding leaves behind for a mock customer.
        await container.pool.query(
          `INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status)
           VALUES ($1, 'mock', $2, $3)`,
          [
            id,
            `mock-${kycStatus === 'REJECTED_PENDING_REVIEW' ? 'verified' : kycStatus.toLowerCase()}-${id}`,
            kycStatus,
          ],
        );
      }
      await container.pool.query(
        `INSERT INTO user_auth (user_id, password_hash, password_algorithm)
         VALUES ($1, NULL, 'argon2id')`,
        [id],
      );
      return { id, email };
    },

    async countRows(table, where) {
      const { rows } = await container.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} ${where ? `WHERE ${where}` : ''}`,
      );
      return Number(rows[0]!.n);
    },
  };
}
