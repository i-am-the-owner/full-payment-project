import { z } from 'zod';

/**
 * Schema for the process environment.
 *
 * Every value the backend reads from the environment is declared here so that
 * configuration errors fail fast at startup rather than at request time.
 * Secrets are read from the environment only – never from committed files.
 */

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Which deployment this is. Without it: production if NODE_ENV=production, else development.
  APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
  // Production only: allow a mock or sandbox provider for a deliberate dry run.
  ALLOW_NON_PROD_PROVIDER: booleanFromString.default(false),
  // Error tracking (Sentry-compatible DSN). Optional; nothing is sent without it.
  SENTRY_DSN: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  APP_VERSION: z.string().min(1).optional(),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  // --- Authentication ----------------------------------------------------
  // HS256 signing secret for access tokens. Must be long and high-entropy.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1).default('almapay'),
  JWT_AUDIENCE: z.string().min(1).default('almapay-mobile'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(12),
  ACCOUNT_LOCK_THRESHOLD: z.coerce.number().int().min(3).max(20).default(5),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  // Base URL the mobile/web client uses for verification & reset links. Not a secret.
  PUBLIC_APP_URL: z.string().url().default('https://app.almapay.example'),

  // This backend's own public base URL. Payout providers send customers back
  // to it after their identity check. Defaults to http://localhost:<PORT>.
  PUBLIC_API_URL: z.string().url().optional(),
  // Countries (ISO 3166-1 alpha-2, comma-separated) whose residents may sign up,
  // used when the payout provider does not publish its own list.
  SENDER_COUNTRIES: z
    .string()
    .regex(/^[A-Z]{2}(,[A-Z]{2})*$/)
    .default('GB'),

  // --- Admin console ------------------------------------------------------
  // Serve the static admin console under /admin-console. The admin API itself
  // is always protected (admin role + two-step sign-in); this only controls
  // whether the page is served. Disable it where admins use another tool.
  ADMIN_CONSOLE_ENABLED: booleanFromString.default(true),
  // Display-only USD rates for the dashboard, e.g. "GBP:1.27,EUR:1.08". Not accounting.
  DASHBOARD_USD_RATES: z
    .string()
    .regex(/^([A-Z]{3}:\d{1,6}(\.\d{1,6})?)?(,[A-Z]{3}:\d{1,6}(\.\d{1,6})?)*$/)
    .default(''),
  MONTHLY_VOLUME_TARGET_USD: z.coerce.number().int().positive().default(3_000_000),

  // --- Email ---------------------------------------------------------------
  // log (default): delivers nothing, only logs. Others send real mail and need their settings.
  EMAIL_PROVIDER: z.enum(['log', 'postmark', 'resend', 'ses']).default('log'),
  // The From address (must be a sender/domain verified with the provider, with SPF/DKIM/DMARC).
  EMAIL_FROM: z.string().min(3).optional(),
  POSTMARK_SERVER_TOKEN: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  AWS_SES_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_SESSION_TOKEN: z.string().min(1).optional(),

  // Where customers are told to write for help (in transfer emails).
  SUPPORT_EMAIL: z.string().email().default('support@almapay.example'),

  // --- Background jobs (webhook processing, notifications, polling) --------
  // Set false to run the web server without the job worker (a separate worker
  // process can run the same code).
  BACKGROUND_JOBS_ENABLED: booleanFromString.default(true),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  // The safety-net poll runs this often...
  STUCK_TRANSFER_POLL_EVERY_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  // ...and checks transfers that are not final and have not changed for this long.
  STUCK_TRANSFER_AFTER_MINUTES: z.coerce.number().int().min(1).max(10_080).default(30),
  // Transfers older than this are no longer polled.
  STUCK_TRANSFER_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Browser origins allowed to call this API (comma-separated, exact https
  // origins; never `*`). Empty: no browser site may read responses (the mobile
  // app is unaffected).
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .refine(
      (value) =>
        value === '' ||
        value
          .split(',')
          .every((origin) => /^https?:\/\/[^/*\s]+$/.test(origin.trim()) && !origin.includes('*')),
      'CORS_ALLOWED_ORIGINS must be exact origins such as https://app.example.com (no paths, no *)',
    ),
  // Hosts a provider's hosted identity-check page may be on (comma-separated
  // hostnames; subdomains match). Required in production for any provider
  // other than the mock: the customer's app is only ever sent to these.
  PROVIDER_REDIRECT_HOSTS: z
    .string()
    .default('')
    .refine(
      (value) =>
        value === '' ||
        value.split(',').every((host) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host.trim())),
      'PROVIDER_REDIRECT_HOSTS must be hostnames such as id.provider.example',
    ),

  // --- Fraud signals (admin alerts, never blocks) ---------------------------
  FRAUD_NEW_RECIPIENTS_PER_DAY_ALERT: z.coerce.number().int().min(1).max(1000).default(5),
  FRAUD_FAILED_TRANSFERS_PER_DAY_ALERT: z.coerce.number().int().min(1).max(1000).default(3),

  // --- Mutual TLS to the payout provider (when it requires it) --------------
  // Paths to the client certificate and private key (PEM), and optionally the
  // provider's CA certificate. The private key never goes in the repository or
  // an environment variable: only its path does. Both paths or neither.
  PROVIDER_MTLS_CERT_PATH: z.string().min(1).optional(),
  PROVIDER_MTLS_KEY_PATH: z.string().min(1).optional(),
  PROVIDER_MTLS_CA_PATH: z.string().min(1).optional(),
  // Only if the private key file is encrypted.
  PROVIDER_MTLS_KEY_PASSPHRASE: z.string().min(1).optional(),

  // --- HTTP hardening --------------------------------------------------
  // Whether the app runs behind a trusted reverse proxy / load balancer.
  TRUST_PROXY: booleanFromString.default(false),
  // Send HSTS. Defaults to on in production (see app-config).
  HSTS_ENABLED: booleanFromString.optional(),

  // --- Rate limiting -------------------------------------------------
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  // Where rate-limit counters live: postgres is shared by all instances; memory is per process.
  RATE_LIMIT_STORE: z.enum(['postgres', 'memory']).default('postgres'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // --- Feature flags ------------------------------------------------------
  // Fund transfers from SomPay's own provider balance. OFF by default and must
  // stay off: SomPay never holds or forwards customer money. With the flag off
  // a transfer stays `awaiting_payment` until the customer pays the provider.
  // Per-customer sending limits, as decimal amounts in TRANSFER_LIMIT_CURRENCY.
  // They count everything the customer pays (fee included). The day is a
  // rolling 24 hours and the month a rolling 30 days.
  TRANSFER_LIMIT_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('GBP'),
  TRANSFER_LIMIT_PER_TRANSFER: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default('5000'),
  TRANSFER_LIMIT_PER_DAY: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default('10000'),
  TRANSFER_LIMIT_PER_MONTH: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default('25000'),

  ALMAPAY_BALANCE_FUNDING_ENABLED: booleanFromString.default(false),
  // Write verification / reset links (which contain live tokens) to the log so
  // a developer can follow them without a mail service. Refused in production.
  DEV_LOG_MAIL_LINKS: booleanFromString.default(false),

  // --- Encryption of provider tokens at rest -------------------------------
  // base64 of 32 random bytes. Required in production. Without it the app runs
  // but refuses to store a provider refresh token.
  ENCRYPTION_KEY: z.string().min(1).optional(),
  // The version of ENCRYPTION_KEY. Increase it when rotating the key.
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  // Older keys still needed to read existing values: "1:<base64>,2:<base64>".
  ENCRYPTION_PREVIOUS_KEYS: z.string().min(1).optional(),

  // --- Payout provider ---------------------------------------------------
  // Which licensed payout provider the backend talks to. `mock` needs no
  // credentials and is the default, so the app always runs out of the box.
  PAYOUT_PROVIDER: z.enum(['mock', 'wise', 'airwallex', 'currencycloud']).default('mock'),
  // Development only: a fixed secret for the mock provider's webhooks, so the
  // dev script can send signed test webhooks to a running server. Random per
  // process when unset. The mock provider is refused in production anyway.
  MOCK_WEBHOOK_SECRET: z.string().min(16).optional(),
  PAYOUT_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
  PAYOUT_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),

  // --- Wise (backend-only; NEVER shipped to a client) ----------------------
  // How SomPay authenticates to Wise.
  //   personal_token  A sandbox personal API token (WISE_API_TOKEN). One Wise
  //                   account stands in for every customer, so it is refused
  //                   against a production host. For testing before partner
  //                   credentials exist.
  //   oauth_partner   Partner OAuth: each customer authorises SomPay and gets
  //                   their own tokens. Needs WISE_CLIENT_ID/WISE_CLIENT_SECRET.
  //                   NOT YET TESTED against Wise (no credentials yet).
  // Validated in the Wise provider config.
  WISE_AUTH_MODE: z.enum(['personal_token', 'oauth_partner']).default('personal_token'),
  // Never defaults to production: the default is Wise's sandbox,
  // https://api.wise-sandbox.com. Production is https://api.wise.com (TLS) or
  // https://api-mtls.transferwise.com (mTLS), and needs WISE_ALLOW_PRODUCTION.
  WISE_API_BASE_URL: z.string().url().optional(),
  // The dated API version used in the path of the newer endpoints.
  WISE_API_VERSION: z
    .string()
    .regex(/^\d{4}Q[1-4]$/)
    .default('2026Q4'),
  // oauth_partner: the page the customer is sent to to authorise SomPay, and the
  // redirect URI registered with Wise. Wise's docs do not publish the authorise
  // address, so it must be given by the Wise team: https only.
  WISE_AUTHORIZE_URL: z.string().url().optional(),
  WISE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  // Currencies customers may pay in (Wise publishes no list of these). Comma-separated.
  WISE_SOURCE_CURRENCIES: z
    .string()
    .regex(/^[A-Z]{3}(,[A-Z]{3})*$/)
    .default('GBP'),
  WISE_ALLOW_PRODUCTION: booleanFromString.default(false),
  WISE_CLIENT_ID: z.string().min(1).optional(),
  WISE_CLIENT_SECRET: z.string().min(1).optional(),
  WISE_API_TOKEN: z.string().min(1).optional(),
  // Wise's RSA public key (PEM) for webhook signature verification.
  WISE_WEBHOOK_PUBLIC_KEY: z.string().min(1).optional(),
  // SomPay's RSA private key (PEM) for signing SCA one-time-tokens.
  WISE_SCA_PRIVATE_KEY: z.string().min(1).optional(),

  // --- Airwallex (required when PAYOUT_PROVIDER=airwallex) -----------------
  // Sandbox by default; production is refused unless explicitly allowed.
  AIRWALLEX_BASE_URL: z.string().url().optional(),
  AIRWALLEX_ALLOW_PRODUCTION: booleanFromString.default(false),
  AIRWALLEX_CLIENT_ID: z.string().min(1).optional(),
  AIRWALLEX_API_KEY: z.string().min(1).optional(),
  // Secret of the webhook notification URL, from the Airwallex web app.
  AIRWALLEX_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Date version sent as `x-api-version` on every call.
  AIRWALLEX_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default('2026-08-21'),
  // Hosted onboarding flow (business accounts only, per Airwallex).
  AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID: z.string().min(1).optional(),
  AIRWALLEX_ONBOARDING_RETURN_URL: z.string().url().optional(),
  AIRWALLEX_ONBOARDING_ERROR_URL: z.string().url().optional(),
  AIRWALLEX_LEGAL_ENTITY_TYPE: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  // Country (ISO 3166-1 alpha-2) new connected accounts are created in.
  AIRWALLEX_ACCOUNT_COUNTRY: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('GB'),
  // Currencies customers can send from (their Airwallex Wallet currencies).
  AIRWALLEX_SOURCE_CURRENCIES: z
    .string()
    .regex(/^[A-Z]{3}(,[A-Z]{3})*$/)
    .default('GBP'),

  // --- Currencycloud (required when PAYOUT_PROVIDER=currencycloud) ---------
  CURRENCYCLOUD_API_BASE_URL: z.string().url().optional(),
  CURRENCYCLOUD_LOGIN_ID: z.string().min(1).optional(),
  CURRENCYCLOUD_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates an environment record.
 *
 * @throws {Error} with a readable summary when validation fails. The summary
 * never includes secret values, only the offending key and reason.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
