import { randomUUID } from 'node:crypto';
import type { AuthenticatedPrincipal } from '../../src/domain/auth/principal.ts';
import {
  InvalidTokenError,
  type AccessTokenClaims,
  type TokenService,
  type VerifiedTokenPrincipal,
} from '../../src/application/auth/token-service.ts';
import type { AuditLog, AuditLogEntry } from '../../src/application/audit/audit-log.ts';
import type { Mailer } from '../../src/application/auth/mailer.ts';
import type { PasswordHasher } from '../../src/application/auth/password-hasher.ts';
import type {
  AuthTokenPurpose,
  AuthTokenStore,
  IssueAuthTokenInput,
} from '../../src/application/auth/auth-token-store.ts';
import type {
  RecordFailedLoginOptions,
  UserAccountRecord,
  UserAccountStore,
} from '../../src/application/auth/user-account-store.ts';
import type {
  ActiveSessionCheck,
  CreateSessionInput,
  SessionRecord,
  SessionStore,
} from '../../src/application/auth/session-store.ts';
import type { Session, RevocationReason } from '../../src/domain/auth/session.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class FakeAuditLog implements AuditLog {
  readonly entries: AuditLogEntry[] = [];
  record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

/** Encodes claims as a JSON string "token". No crypto. */
export class FakeTokenService implements TokenService {
  issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return Promise.resolve(
      `fake.${Buffer.from(
        JSON.stringify({ ...claims, roles: [...claims.roles], jti: randomUUID() }),
      ).toString('base64url')}`,
    );
  }
  verifyAccessToken(token: string): Promise<VerifiedTokenPrincipal> {
    if (!token.startsWith('fake.')) {
      return Promise.reject(new InvalidTokenError('not a fake token'));
    }
    const decoded = JSON.parse(Buffer.from(token.slice(5), 'base64url').toString()) as {
      userId: string;
      roles: AuthenticatedPrincipal['roles'];
      sessionId: string;
      emailVerified: boolean;
      jti: string;
    };
    return Promise.resolve({
      userId: decoded.userId,
      roles: decoded.roles,
      sessionId: decoded.sessionId,
      emailVerified: decoded.emailVerified,
      tokenId: decoded.jti,
    });
  }
}

export interface SentMail {
  template: string;
  to: string;
  url?: string;
}

export class FakeMailer implements Mailer {
  readonly sent: SentMail[] = [];
  sendEmailVerification(to: string, url: string): Promise<void> {
    return this.#record('email_verification', to, url);
  }
  sendPasswordReset(to: string, url: string): Promise<void> {
    return this.#record('password_reset', to, url);
  }
  sendPasswordChangedNotice(to: string): Promise<void> {
    return this.#record('password_changed', to);
  }
  sendDuplicateRegistrationNotice(to: string): Promise<void> {
    return this.#record('duplicate_registration', to);
  }
  lastUrl(): string | undefined {
    return [...this.sent].reverse().find((m) => m.url)?.url;
  }
  #record(template: string, to: string, url?: string): Promise<void> {
    this.sent.push(url === undefined ? { template, to } : { template, to, url });
    return Promise.resolve();
  }
}

/** Deterministic hasher: "hash" = `hashed:<plain>`. No crypto, fast. */
export class FakePasswordHasher implements PasswordHasher {
  rehashNeeded = false;
  hash(plainText: string): Promise<string> {
    return Promise.resolve(`hashed:${plainText}`);
  }
  verify(storedHash: string, plainText: string): Promise<boolean> {
    return Promise.resolve(storedHash === `hashed:${plainText}`);
  }
  needsRehash(): boolean {
    return this.rehashNeeded;
  }
}

interface StoredToken extends IssueAuthTokenInput {
  consumed: boolean;
}

export class FakeAuthTokenStore implements AuthTokenStore {
  readonly tokens: StoredToken[] = [];
  issue(input: IssueAuthTokenInput): Promise<void> {
    this.tokens.push({ ...input, consumed: false });
    return Promise.resolve();
  }
  consume(input: {
    purpose: AuthTokenPurpose;
    tokenHash: string;
  }): Promise<{ userId: string } | null> {
    const token = this.tokens.find(
      (t) =>
        !t.consumed &&
        t.purpose === input.purpose &&
        t.tokenHash === input.tokenHash &&
        t.expiresAt.getTime() > Date.now(),
    );
    if (!token) {
      return Promise.resolve(null);
    }
    token.consumed = true;
    return Promise.resolve({ userId: token.userId });
  }
  invalidateAllPending(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    for (const token of this.tokens) {
      if (token.userId === userId && token.purpose === purpose) {
        token.consumed = true;
      }
    }
    return Promise.resolve();
  }
}

export type FakeAccount = Mutable<UserAccountRecord>;

export class FakeUserAccountStore implements UserAccountStore {
  readonly accounts = new Map<string, FakeAccount>();

  seed(partial: Partial<FakeAccount> & { email: string }): FakeAccount {
    const account: FakeAccount = {
      id: partial.id ?? randomUUID(),
      email: partial.email,
      status: partial.status ?? 'active',
      emailVerified: partial.emailVerified ?? false,
      passwordHash: partial.passwordHash ?? null,
      failedLoginAttempts: partial.failedLoginAttempts ?? 0,
      lockedUntil: partial.lockedUntil ?? null,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  findByEmail(email: string): Promise<UserAccountRecord | null> {
    return Promise.resolve([...this.accounts.values()].find((a) => a.email === email) ?? null);
  }
  findById(id: string): Promise<UserAccountRecord | null> {
    return Promise.resolve(this.accounts.get(id) ?? null);
  }
  createAccount(input: { email: string; passwordHash: string }): Promise<{ id: string }> {
    const account = this.seed({ email: input.email, passwordHash: input.passwordHash });
    return Promise.resolve({ id: account.id });
  }
  setStatus(userId: string, status: 'active' | 'suspended' | 'closed'): Promise<void> {
    const account = this.accounts.get(userId);
    if (account) account.status = status;
    return Promise.resolve();
  }
  setPassword(userId: string, passwordHash: string): Promise<void> {
    const account = this.accounts.get(userId);
    if (account) {
      account.passwordHash = passwordHash;
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
    }
    return Promise.resolve();
  }
  markEmailVerified(userId: string): Promise<void> {
    const account = this.accounts.get(userId);
    if (account) {
      account.emailVerified = true;
    }
    return Promise.resolve();
  }
  recordFailedLogin(
    userId: string,
    options: RecordFailedLoginOptions,
  ): Promise<{ locked: boolean }> {
    const account = this.accounts.get(userId);
    if (!account) {
      return Promise.resolve({ locked: false });
    }
    account.failedLoginAttempts += 1;
    if (account.failedLoginAttempts >= options.lockThreshold) {
      account.lockedUntil = new Date(Date.now() + options.lockDurationMinutes * 60 * 1000);
    }
    return Promise.resolve({
      locked: account.lockedUntil !== null && account.lockedUntil.getTime() > Date.now(),
    });
  }
  recordSuccessfulLogin(userId: string): Promise<void> {
    const account = this.accounts.get(userId);
    if (account) {
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
    }
    return Promise.resolve();
  }
}

type StoredSession = Mutable<SessionRecord> & { refreshTokenHash: string };

export class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, StoredSession>();
  userStatusById = new Map<string, ActiveSessionCheck['userStatus']>();
  emailVerifiedById = new Map<string, boolean>();
  providerVerifiedById = new Map<string, boolean>();

  #userStatus(userId: string): ActiveSessionCheck['userStatus'] {
    return this.userStatusById.get(userId) ?? 'active';
  }
  #emailVerified(userId: string): boolean {
    return this.emailVerifiedById.get(userId) ?? false;
  }

  create(input: CreateSessionInput & { refreshTokenHash: string }): Promise<Session> {
    const id = randomUUID();
    const session: StoredSession = {
      id,
      userId: input.userId,
      familyId: input.familyId ?? randomUUID(),
      roles: input.roles,
      status: 'active',
      createdAt: new Date(),
      lastUsedAt: new Date(),
      expiresAt: input.expiresAt,
      refreshTokenHash: input.refreshTokenHash,
      userStatus: this.#userStatus(input.userId),
      emailVerified: this.#emailVerified(input.userId),
    };
    this.sessions.set(id, session);
    return Promise.resolve(session);
  }
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    const session = [...this.sessions.values()].find((s) => s.refreshTokenHash === hash);
    if (!session) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...session, userStatus: this.#userStatus(session.userId) });
  }
  findActiveWithUser(sessionId: string): Promise<ActiveSessionCheck | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active' || session.expiresAt.getTime() <= Date.now()) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      userId: session.userId,
      userStatus: this.#userStatus(session.userId),
      emailVerified: this.#emailVerified(session.userId),
      providerVerified: this.providerVerifiedById.get(session.userId) ?? false,
      needsRelink: false,
    });
  }
  markRotated(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'active') {
      session.status = 'rotated';
    }
    return Promise.resolve();
  }
  touch(): Promise<void> {
    return Promise.resolve();
  }
  revoke(sessionId: string, _reason: RevocationReason): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'revoked';
    }
    return Promise.resolve();
  }
  revokeFamily(familyId: string, _reason: RevocationReason): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId && session.status !== 'revoked') {
        session.status = 'revoked';
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
  revokeAllForUser(userId: string, _reason: RevocationReason): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.status !== 'revoked') {
        session.status = 'revoked';
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}
