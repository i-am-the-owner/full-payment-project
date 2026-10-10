import type { Store } from 'express-rate-limit';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Env } from './env.ts';
import type { ProviderName } from '../domain/payout/models.ts';
import type { LogLevel } from '../shared/logger.ts';

export interface DatabaseConfig {
  readonly url: string;
  readonly poolMax: number;
}

export interface AuthConfig {
  readonly jwtSecret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlDays: number;
  readonly emailVerificationTtlHours: number;
  readonly passwordResetTtlMinutes: number;
  readonly passwordMinLength: number;
  readonly accountLockThreshold: number;
  readonly accountLockMinutes: number;
  /** Base URL used to build verification / reset links. Not a secret. */
  readonly publicAppUrl: string;
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly globalMax: number;
  readonly authMax: number;
  /**
   * Where counters live. Absent means in this process's memory (one count per
   * instance). The composition root supplies a shared (Postgres) store.
   */
  readonly storeFactory?: (prefix: string) => Store;
}

export interface HttpSecurityConfig {
  readonly trustProxy: boolean;
  readonly hstsEnabled: boolean;
  /** Reject plain-HTTP requests (only meaningful behind a trusted proxy). */
  readonly requireHttps: boolean;
}

/** Application configuration derived from validated environment values. */
export interface AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly version: string;
  readonly isProduction: boolean;
  readonly database: DatabaseConfig;
  readonly auth: AuthConfig;
  readonly rateLimit: RateLimitConfig;
  readonly httpSecurity: HttpSecurityConfig;
  readonly features: FeatureFlags;
  /** Per-customer sending limits (decimal strings, never floats). */
  readonly transferLimits: {
    readonly currency: string;
    readonly perTransfer: string;
    readonly perDay: string;
    readonly perMonth: string;
  };
  /** The payout provider selected by `PAYOUT_PROVIDER`. */
  readonly admin: {
    readonly consoleEnabled: boolean;
    readonly usdRates: Readonly<Record<string, string>>;
    readonly monthlyTargetUsd: number;
  };
  readonly payoutProvider: ProviderName;
  /** This backend's public base URL, for provider redirects back to us. */
  readonly publicApiUrl: string;
  /** Sender countries used when the provider does not publish its own list. */
  readonly senderCountries: readonly string[];
  readonly supportEmail: string;
  readonly background: BackgroundConfig;
  /** Browser origins allowed to call the API. Empty: none. */
  readonly corsAllowedOrigins: readonly string[];
  /** Hosts a provider's hosted identity page may be on. */
  readonly providerRedirectHosts: readonly string[];
  readonly fraud: {
    readonly newRecipientsPerDay: number;
    readonly failedTransfersPerDay: number;
  };
}

export interface BackgroundConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly stuckPollEveryMinutes: number;
  readonly stuckAfterMinutes: number;
  readonly stuckMaxAgeDays: number;
}

export interface FeatureFlags {
  /** Fund transfers from SomPay's own provider balance. Off by default. */
  readonly balanceFundingEnabled: boolean;
  /** Log verification / reset links for local development. Never in production. */
  readonly devLogMailLinks: boolean;
  /** Temporary: mark new accounts email-verified instead of sending a code. Never in production. */
  readonly skipEmailVerification: boolean;
}

export class ConfigError extends Error {}

// The value shipped in `.env.example`. It is public, so it must never sign
// production tokens.
const EXAMPLE_JWT_SECRET = 'dev-only-insecure-secret-change-me-0123456789';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Whether a Postgres connection string asks for TLS. */
function databaseUsesTls(url: string): boolean {
  try {
    const mode = new URL(url).searchParams.get('sslmode');
    const ssl = new URL(url).searchParams.get('ssl');
    return ['require', 'verify-ca', 'verify-full'].includes(mode ?? '') || ssl === 'true';
  } catch {
    return false;
  }
}

/** A decimal string such as "5000" or "250.50" as an integer count of 1/10,000ths. */
function scaled(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

/** Limits must grow with the period: one transfer cannot exceed the day, nor the day the month. */
function assertLimitsConsistent(env: Env): void {
  const perTransfer = scaled(env.TRANSFER_LIMIT_PER_TRANSFER);
  const perDay = scaled(env.TRANSFER_LIMIT_PER_DAY);
  const perMonth = scaled(env.TRANSFER_LIMIT_PER_MONTH);
  if (perTransfer > perDay || perDay > perMonth) {
    throw new ConfigError(
      'TRANSFER_LIMIT_PER_TRANSFER must not exceed TRANSFER_LIMIT_PER_DAY, which must not exceed ' +
        `TRANSFER_LIMIT_PER_MONTH (got ${env.TRANSFER_LIMIT_PER_TRANSFER} / ${env.TRANSFER_LIMIT_PER_DAY} / ${env.TRANSFER_LIMIT_PER_MONTH}).`,
    );
  }
}

/** Refuses configurations that are unsafe in production. */
function assertProductionSafe(env: Env): void {
  const problems: string[] = [];
  if (
    env.JWT_SECRET === EXAMPLE_JWT_SECRET ||
    /dev-only|insecure|change-me/i.test(env.JWT_SECRET)
  ) {
    problems.push('JWT_SECRET is a placeholder value; generate a real secret.');
  }
  if (!env.ENCRYPTION_KEY) {
    problems.push('ENCRYPTION_KEY must be set: provider tokens are encrypted at rest.');
  }
  if (!env.PUBLIC_API_URL || !env.PUBLIC_API_URL.startsWith('https://')) {
    problems.push("PUBLIC_API_URL must be set to this API's public https:// address.");
  }
  if (env.DEV_LOG_MAIL_LINKS) {
    problems.push('DEV_LOG_MAIL_LINKS must not be enabled in production.');
  }
  if (env.SKIP_EMAIL_VERIFICATION && env.APP_ENV === 'production') {
    problems.push('SKIP_EMAIL_VERIFICATION must not be enabled when APP_ENV=production.');
  }
  if (!env.TRUST_PROXY) {
    // The API speaks plain HTTP to a TLS-terminating proxy; without this it
    // cannot tell whether a request arrived over HTTPS and would not refuse HTTP.
    problems.push('TRUST_PROXY must be true: serve the API behind a TLS-terminating proxy.');
  }
  if (!databaseUsesTls(env.DATABASE_URL)) {
    problems.push(
      'DATABASE_URL must require TLS (add ?sslmode=require, or verify-full for a private CA).',
    );
  }
  if (env.PAYOUT_PROVIDER !== 'mock' && splitList(env.PROVIDER_REDIRECT_HOSTS).length === 0) {
    problems.push(
      "PROVIDER_REDIRECT_HOSTS must list the hosts of the provider's hosted identity page.",
    );
  }
  if (splitList(env.CORS_ALLOWED_ORIGINS).some((origin) => !origin.startsWith('https://'))) {
    problems.push('CORS_ALLOWED_ORIGINS must be https:// origins in production.');
  }
  if (env.MOCK_WEBHOOK_SECRET) {
    problems.push('MOCK_WEBHOOK_SECRET is for development only.');
  }
  if (env.MOCK_SKIP_IDENTITY_CHECK) {
    problems.push('MOCK_SKIP_IDENTITY_CHECK is for development only.');
  }
  if (problems.length > 0) {
    throw new ConfigError(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

const packageJsonSchema = z.object({ version: z.string().min(1) });

/** Reads the backend package version, used as the default reported version. */
export function readPackageVersion(): string {
  const packageJsonUrl = new URL('../../package.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));
  return packageJsonSchema.parse(parsed).version;
}

/** Builds the immutable {@link AppConfig} from a validated environment. */
export function loadConfig(env: Env, packageVersion: string): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  assertLimitsConsistent(env);
  if (isProduction) {
    assertProductionSafe(env);
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    version: env.APP_VERSION ?? packageVersion,
    isProduction,
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      emailVerificationTtlHours: env.EMAIL_VERIFICATION_TTL_HOURS,
      passwordResetTtlMinutes: env.PASSWORD_RESET_TTL_MINUTES,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      accountLockThreshold: env.ACCOUNT_LOCK_THRESHOLD,
      accountLockMinutes: env.ACCOUNT_LOCK_MINUTES,
      publicAppUrl: env.PUBLIC_APP_URL,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      globalMax: env.RATE_LIMIT_MAX,
      authMax: env.AUTH_RATE_LIMIT_MAX,
    },
    httpSecurity: {
      trustProxy: env.TRUST_PROXY,
      hstsEnabled: env.HSTS_ENABLED ?? isProduction,
      requireHttps: isProduction && env.TRUST_PROXY,
    },
    transferLimits: {
      currency: env.TRANSFER_LIMIT_CURRENCY,
      perTransfer: env.TRANSFER_LIMIT_PER_TRANSFER,
      perDay: env.TRANSFER_LIMIT_PER_DAY,
      perMonth: env.TRANSFER_LIMIT_PER_MONTH,
    },
    features: {
      balanceFundingEnabled: env.ALMAPAY_BALANCE_FUNDING_ENABLED,
      devLogMailLinks: env.DEV_LOG_MAIL_LINKS,
      skipEmailVerification: env.SKIP_EMAIL_VERIFICATION,
    },
    admin: {
      consoleEnabled: env.ADMIN_CONSOLE_ENABLED,
      usdRates: Object.fromEntries(
        splitList(env.DASHBOARD_USD_RATES).map((pair): [string, string] => {
          const [code = '', rate = ''] = pair.split(':');
          return [code, rate];
        }),
      ),
      monthlyTargetUsd: env.MONTHLY_VOLUME_TARGET_USD,
    },
    payoutProvider: env.PAYOUT_PROVIDER,
    publicApiUrl: (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, ''),
    senderCountries: env.SENDER_COUNTRIES.split(','),
    supportEmail: env.SUPPORT_EMAIL,
    corsAllowedOrigins: splitList(env.CORS_ALLOWED_ORIGINS),
    providerRedirectHosts: splitList(env.PROVIDER_REDIRECT_HOSTS).map((host) => host.toLowerCase()),
    fraud: {
      newRecipientsPerDay: env.FRAUD_NEW_RECIPIENTS_PER_DAY_ALERT,
      failedTransfersPerDay: env.FRAUD_FAILED_TRANSFERS_PER_DAY_ALERT,
    },
    background: {
      enabled: env.BACKGROUND_JOBS_ENABLED,
      pollIntervalMs: env.JOBS_POLL_INTERVAL_MS,
      stuckPollEveryMinutes: env.STUCK_TRANSFER_POLL_EVERY_MINUTES,
      stuckAfterMinutes: env.STUCK_TRANSFER_AFTER_MINUTES,
      stuckMaxAgeDays: env.STUCK_TRANSFER_MAX_AGE_DAYS,
    },
  };
}
