import { parseEnv } from './config/env.ts';
import {
  ConfigError,
  loadConfig,
  readPackageVersion,
  type AppConfig,
} from './config/app-config.ts';
import { createLogger, type Logger, type LogLevel } from './shared/logger.ts';
import {
  createGetServiceHealth,
  type GetServiceHealth,
} from './application/health/get-service-health.ts';
import { createCheckReadiness, type CheckReadiness } from './application/health/check-readiness.ts';
import { createGetCurrentUser, type GetCurrentUser } from './application/auth/get-current-user.ts';
import {
  createAuthenticateAccessToken,
  type AccessTokenAuthenticator,
} from './application/auth/authenticate-access-token.ts';
import { SessionService } from './application/auth/session-service.ts';
import { createRegisterUser } from './application/auth/register-user.ts';
import { createLoginUser } from './application/auth/login-user.ts';
import { createRefreshSession } from './application/auth/refresh-session.ts';
import { createLogout, createLogoutAll } from './application/auth/logout.ts';
import {
  createResendEmailVerification,
  createVerifyEmail,
} from './application/auth/verify-email.ts';
import {
  createRequestPasswordReset,
  createResetPassword,
} from './application/auth/password-reset.ts';
import { JwtTokenService } from './infrastructure/auth/jwt-token-service.ts';
import { Argon2PasswordHasher } from './infrastructure/auth/argon2-password-hasher.ts';
import { createDatabasePool, type DatabasePool } from './infrastructure/database/pool.ts';
import { databaseCheck } from './infrastructure/database/health-check.ts';
import { PostgresUserDirectory } from './infrastructure/database/postgres-user-directory.ts';
import { PostgresUserAccountStore } from './infrastructure/database/postgres-user-account-store.ts';
import { PostgresSessionStore } from './infrastructure/database/postgres-session-store.ts';
import { PostgresAuthTokenStore } from './infrastructure/database/postgres-auth-token-store.ts';
import { PostgresAuditLog } from './infrastructure/database/postgres-audit-log.ts';
import { PROVIDER_DISPLAY_NAMES } from './domain/payout/models.ts';
import { createEmailSender } from './infrastructure/mail/create-email-sender.ts';
import { TemplatedMailer } from './infrastructure/mail/templated-mailer.ts';
import type { PayoutProvider } from './application/payout/payout-provider.ts';
import { CurrencyCatalogue } from './application/payout/currency-catalogue.ts';
import { createCustomerOnboarding } from './application/payout/customer-onboarding.ts';
import {
  createCustomerProfiles,
  createSenderCountries,
} from './application/payout/customer-profile.ts';
import { withRelinkGuard } from './application/payout/relink-guard.ts';
import { createTwoFactor } from './application/auth/two-factor.ts';
import { generateTotpSecret, totpUri, verifyTotp } from './infrastructure/auth/totp.ts';
import { PostgresOnboardingStateStore } from './infrastructure/database/postgres-onboarding-state-store.ts';
import { PostgresProfileStore } from './infrastructure/database/postgres-profile-store.ts';
import { PostgresTotpStore } from './infrastructure/database/postgres-totp-store.ts';
import { createRequestQuote } from './application/transfer/request-quote.ts';
import {
  createAddRecipient,
  createGetRecipientForm,
  createRemoveRecipient,
} from './application/transfer/add-recipient.ts';
import { createAttachRecipientToQuote } from './application/transfer/reprice-quote.ts';
import {
  createFundTransfer,
  createGetTransferFunding,
} from './application/transfer/fund-transfer.ts';
import { createTransferLimits } from './application/transfer/transfer-limits.ts';
import {
  createConfirmTransfer,
  createGetTransferForm,
} from './application/transfer/confirm-transfer.ts';
import { createCancelTransfer } from './application/transfer/cancel-transfer.ts';
import {
  createGetTransfer,
  createGetTransferDetail,
  createListRecipients,
  createListTransfers,
  createRefreshTransfer,
} from './application/transfer/transfer-queries.ts';
import { createApplyProviderTransferUpdate } from './application/transfer/apply-provider-transfer-update.ts';
import {
  createReceiveProviderWebhook,
  JOB_PROCESS_WEBHOOK,
} from './application/transfer/receive-provider-webhook.ts';
import { createProcessWebhookEvent } from './application/transfer/process-webhook-event.ts';
import {
  createPollStuckTransfers,
  JOB_POLL_STUCK_TRANSFERS,
} from './application/transfer/poll-stuck-transfers.ts';
import {
  createOnProviderStatusApplied,
  JOB_NOTIFY_TRANSFER,
} from './application/transfer/on-status-applied.ts';
import { createFraudSignals } from './application/fraud/fraud-signals.ts';
import { createConfirmPassword } from './application/auth/confirm-password.ts';
import { createManageUserAccounts } from './application/admin/manage-user-accounts.ts';
import { createNotifyTransfer } from './application/notifications/notify-transfer.ts';
import type { AdminAlerts } from './application/notifications/admin-alerts.ts';
import type { TransferMailer } from './application/notifications/ports.ts';
import type { AccountMailer, Mailer } from './application/auth/mailer.ts';
import { createJobRunner, createScheduler, type JobRunner } from './application/jobs/job-runner.ts';
import { PostgresJobQueue } from './infrastructure/database/postgres-job-queue.ts';
import { PostgresAdminAlerts } from './infrastructure/database/postgres-admin-alerts.ts';
import { PostgresNotificationLog } from './infrastructure/database/postgres-notification-log.ts';
import { hostname } from 'node:os';
import { createPayoutProvider } from './infrastructure/providers/create-payout-provider.ts';
import { MockPayoutProvider } from './infrastructure/providers/mock/mock-payout-provider.ts';
import { PostgresCurrencyRegistry } from './infrastructure/database/postgres-currency-registry.ts';
import { PostgresCustomerLinkStore } from './infrastructure/database/postgres-customer-link-store.ts';
import { loadTokenCipher } from './infrastructure/crypto/token-cipher.ts';
import { PostgresAdminAccessStore } from './infrastructure/database/postgres-admin-access-store.ts';
import { PostgresAdminQueries } from './infrastructure/database/postgres-admin-queries.ts';
import { PostgresRateLimitStore } from './infrastructure/database/postgres-rate-limit-store.ts';
import { PostgresRecoveryCodeStore } from './infrastructure/database/postgres-recovery-code-store.ts';
import { createTransferPause } from './application/settings/transfer-pause.ts';
import { PostgresTransferPauseStore } from './infrastructure/database/postgres-transfer-pause-store.ts';
import { PostgresQuoteRepository } from './infrastructure/database/postgres-quote-repository.ts';
import { PostgresRecipientRepository } from './infrastructure/database/postgres-recipient-repository.ts';
import { PostgresTransferRepository } from './infrastructure/database/postgres-transfer-repository.ts';
import { PostgresWebhookEventRepository } from './infrastructure/database/postgres-webhook-event-repository.ts';
import {
  createSentryReporter,
  noopErrorReporter,
  type ErrorReporter,
} from './shared/error-reporter.ts';
import { resolveAppEnvironment } from './infrastructure/providers/environment-policy.ts';
import type { HttpDependencies } from './interfaces/http/create-app.ts';

/**
 * Composition root. Builds the object graph once at startup so that the rest of
 * the codebase depends on interfaces, not on construction details.
 */
export interface Container extends HttpDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly errorReporter: ErrorReporter;
  readonly pool: DatabasePool;
  readonly getServiceHealth: GetServiceHealth;
  readonly checkReadiness: CheckReadiness;
  readonly getCurrentUser: GetCurrentUser;
  readonly authenticator: AccessTokenAuthenticator;
  /** Exposed for tests and future admin tooling. */
  readonly sessionService: SessionService;
  /** The payout provider selected by `PAYOUT_PROVIDER` (or injected by a test). */
  readonly payoutProvider: PayoutProvider;
  /** Things an admin must look at. */
  readonly adminAlerts: AdminAlerts;
  /** The background worker: webhook processing, customer notifications, polling. */
  readonly background: BackgroundJobs;
  shutdown(): Promise<void>;
}

export interface BackgroundJobs {
  readonly runner: JobRunner;
  /** Runs the safety-net poll for stuck transfers now. */
  pollStuckTransfers(): Promise<{
    checked: number;
    changed: number;
    adopted: number;
    errors: number;
  }>;
  /** Starts the worker and the scheduler. Called by the server, not by tests. */
  start(): void;
  stop(): Promise<void>;
}

export interface ContainerOverrides {
  /** Substitute the mailer (account emails and transfer notices). Used by tests. */
  readonly mailer?: Mailer & TransferMailer;
  /** Redirect structured log output. Used by tests to assert on log content. */
  readonly logWrite?: (level: LogLevel, line: string) => void;
  /** Substitute the payout provider. Used by tests to inject failures. */
  readonly payoutProvider?: PayoutProvider;
}

export function createContainer(
  processEnv: NodeJS.ProcessEnv,
  overrides: ContainerOverrides = {},
): Container {
  const env = parseEnv(processEnv);
  const config = loadConfig(env, readPackageVersion());

  const logger = createLogger({
    level: config.logLevel,
    base: { service: 'almapay-backend', env: config.nodeEnv, appEnv: resolveAppEnvironment(env) },
    ...(overrides.logWrite ? { write: overrides.logWrite } : {}),
  });

  const errorReporter: ErrorReporter = env.SENTRY_DSN
    ? createSentryReporter({
        dsn: env.SENTRY_DSN,
        environment: resolveAppEnvironment(env),
        release: config.version,
        logger,
      })
    : noopErrorReporter;
  if (env.ALLOW_NON_PROD_PROVIDER && resolveAppEnvironment(env) === 'production') {
    logger.warn('config.non_prod_provider_allowed', {
      note: 'ALLOW_NON_PROD_PROVIDER=true in production: no real money moves.',
    });
  }

  const pool = createDatabasePool(config.database.url, {
    max: config.database.poolMax,
    statementTimeoutMs: 15_000,
  });
  pool.on('error', (error) => {
    logger.error('db.pool.error', { error });
  });

  const clock = (): Date => new Date();

  // --- Infrastructure adapters -------------------------------------------
  const tokenService = new JwtTokenService(config.auth);
  const passwordHasher = new Argon2PasswordHasher();
  const userDirectory = new PostgresUserDirectory(pool);
  const userAccountStore = new PostgresUserAccountStore(pool);
  const sessionStore = new PostgresSessionStore(
    pool,
    overrides.payoutProvider?.name ?? config.payoutProvider,
  );
  const authTokenStore = new PostgresAuthTokenStore(pool);
  const auditLog = new PostgresAuditLog(pool, logger);
  const emailSender = overrides.mailer
    ? undefined
    : createEmailSender({ env, logger, includeBodies: config.features.devLogMailLinks });
  if (emailSender?.name === 'log' && resolveAppEnvironment(env) === 'production') {
    if (!env.ALLOW_NON_PROD_PROVIDER) {
      throw new ConfigError(
        'EMAIL_PROVIDER=log sends no email, so customers would get no verification, reset or transfer ' +
          'emails. Set EMAIL_PROVIDER to postmark, resend or ses (or ALLOW_NON_PROD_PROVIDER=true for a dry run).',
      );
    }
    logger.warn('config.email_log_only', { note: 'No customer email is delivered.' });
  }
  const mailer: Mailer & TransferMailer =
    overrides.mailer ??
    new TemplatedMailer({
      sender: emailSender!,
      logger,
      supportEmail: config.supportEmail,
      providerName: () => PROVIDER_DISPLAY_NAMES[config.payoutProvider],
      resetMinutes: config.auth.passwordResetTtlMinutes,
    });
  const jobQueue = new PostgresJobQueue(pool);
  const adminAlerts = new PostgresAdminAlerts(pool, logger);
  const adminAccess = new PostgresAdminAccessStore(pool);
  const adminQueries = new PostgresAdminQueries(pool);
  const notificationLog = new PostgresNotificationLog(pool);

  const currencyRegistry = new PostgresCurrencyRegistry(pool);
  const tokenCipher = loadTokenCipher(env);
  const customerLinkStore = new PostgresCustomerLinkStore(pool, tokenCipher);
  const onboardingStateStore = new PostgresOnboardingStateStore(pool);
  const profileStore = new PostgresProfileStore(pool);
  const totpStore = new PostgresTotpStore(pool, tokenCipher);
  const quoteRepository = new PostgresQuoteRepository(pool);
  const recipientRepository = new PostgresRecipientRepository(pool);
  const transferRepository = new PostgresTransferRepository(pool);
  const webhookEventRepository = new PostgresWebhookEventRepository(pool);

  // --- Payout provider: the only place a concrete provider is chosen -------
  const selectedProvider: PayoutProvider =
    overrides.payoutProvider ??
    createPayoutProvider({
      env,
      logger,
      auditLog,
      currencyMinorUnits: (code) => currencyRegistry.minorUnitExponent(code),
      refreshTokens: {
        read: (customerRef) => customerLinkStore.readRefreshTokenByRef('wise', customerRef),
        save: (customerRef, token) =>
          customerLinkStore.saveRefreshTokenByRef('wise', customerRef, token),
      },
    });
  // Any provider call that reports the customer's connection as broken marks
  // their link NEEDS_RELINK, which blocks sending until they reconnect.
  const provider = withRelinkGuard(selectedProvider, customerLinkStore);
  logger.info('payout.provider.selected', { provider: provider.name });

  const currencyCatalogue = new CurrencyCatalogue({ provider, currencyRegistry, clock });
  const senderCountries = createSenderCountries({
    currencyCatalogue,
    configured: config.senderCountries,
  });
  const findUserEmail = async (userId: string): Promise<string | null> => {
    const user = await userDirectory.findById(userId);
    return user?.status === 'active' ? user.email : null;
  };
  const twoFactor = createTwoFactor({
    totpStore,
    recoveryCodes: new PostgresRecoveryCodeStore(pool),
    totp: { generateSecret: generateTotpSecret, verify: verifyTotp, uri: totpUri },
    findUserEmail,
    auditLog,
    clock,
    issuer: 'SomPay',
  });

  // --- Transfer / send-money use cases ---------------------------------
  const fraudSignals = createFraudSignals({
    recipientRepository,
    transferRepository,
    adminAlerts,
    thresholds: config.fraud,
    clock,
    logger,
  });
  const applyProviderTransferUpdate = createApplyProviderTransferUpdate({
    transferRepository,
    auditLog,
    onApplied: createOnProviderStatusApplied({ jobQueue, adminAlerts, fraudSignals, logger }),
  });
  const receiveProviderWebhook = createReceiveProviderWebhook({
    provider,
    webhookEventRepository,
    jobQueue,
    auditLog,
    logger,
  });
  const pollStuckTransfers = createPollStuckTransfers({
    provider,
    customerLinkStore,
    transferRepository,
    applyProviderTransferUpdate,
    adminAlerts,
    logger,
    clock,
    config: {
      stuckAfterMs: config.background.stuckAfterMinutes * 60_000,
      maxAgeMs: config.background.stuckMaxAgeDays * 24 * 60 * 60_000,
      minGapMs: Math.max(1, config.background.stuckPollEveryMinutes - 5) * 60_000,
      batchSize: 100,
      unconfirmedAlertAfterMs: 60 * 60_000,
    },
  });
  const jobRunner = createJobRunner({
    queue: jobQueue,
    adminAlerts,
    logger,
    clock,
    workerId: `${hostname()}:${process.pid}`,
    handlers: {
      [JOB_PROCESS_WEBHOOK]: createProcessWebhookEvent({
        webhookEventRepository,
        applyProviderTransferUpdate,
        customerLinkStore,
        adminAlerts,
        auditLog,
        logger,
      }),
      [JOB_NOTIFY_TRANSFER]: createNotifyTransfer({
        transferRepository,
        recipientRepository,
        currencyRegistry,
        notificationLog,
        mailer,
        findUserEmail,
        supportEmail: config.supportEmail,
        logger,
      }),
      [JOB_POLL_STUCK_TRANSFERS]: async () => {
        await pollStuckTransfers();
      },
    },
  });
  const scheduler = createScheduler({
    queue: jobQueue,
    clock,
    logger,
    tasks: [
      { type: JOB_POLL_STUCK_TRANSFERS, everyMs: config.background.stuckPollEveryMinutes * 60_000 },
    ],
  });
  const background: BackgroundJobs = {
    runner: jobRunner,
    pollStuckTransfers,
    start() {
      if (!config.background.enabled) {
        logger.info('background.jobs.disabled');
        return;
      }
      jobRunner.start(config.background.pollIntervalMs);
      scheduler.start(60_000);
      logger.info('background.jobs.started', {
        pollEveryMinutes: config.background.stuckPollEveryMinutes,
        stuckAfterMinutes: config.background.stuckAfterMinutes,
      });
    },
    async stop() {
      scheduler.stop();
      await jobRunner.stop();
    },
  };
  const getTransfer = createGetTransfer({ transferRepository });
  const recipientDeps = {
    provider,
    customerLinkStore,
    quoteRepository,
    recipientRepository,
    auditLog,
    fraudSignals,
  };
  const transferPause = createTransferPause({
    store: new PostgresTransferPauseStore(pool),
    verifyAdminCode: (adminUserId, code) => twoFactor.verifyCode(adminUserId, code),
    auditLog,
  });
  const confirmDeps = {
    transferPause,
    provider,
    customerLinkStore,
    quoteRepository,
    recipientRepository,
    transferRepository,
    auditLog,
    fraudSignals,
    clock,
    transferLimits: createTransferLimits({
      config: config.transferLimits,
      currencyCatalogue,
      transferRepository,
      clock,
    }),
    balanceFundingEnabled: config.features.balanceFundingEnabled,
  };
  const fundingDeps = { provider, customerLinkStore, transferRepository, auditLog, clock };

  // --- Application services / use cases -------------------------------
  const sessionService = new SessionService({
    tokenService,
    sessionStore,
    auditLog,
    clock,
    refreshTokenTtlDays: config.auth.refreshTokenTtlDays,
    accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds,
  });

  const emailTokenDeps = {
    authTokenStore,
    mailer,
    clock,
    emailVerificationTtlHours: config.auth.emailVerificationTtlHours,
    publicAppUrl: config.auth.publicAppUrl,
  };

  const authenticator = createAuthenticateAccessToken({ tokenService, sessionStore });

  const container: Container = {
    config,
    logger,
    errorReporter,
    pool,
    getServiceHealth: createGetServiceHealth({
      version: config.version,
      uptimeSeconds: () => process.uptime(),
      now: clock,
    }),
    checkReadiness: createCheckReadiness([databaseCheck(pool)]),
    getCurrentUser: createGetCurrentUser(userDirectory),
    authenticator,
    sessionService,
    rateLimit:
      env.RATE_LIMIT_STORE === 'postgres'
        ? {
            ...config.rateLimit,
            storeFactory: (prefix) => new PostgresRateLimitStore(pool, logger, prefix),
          }
        : config.rateLimit,
    payoutProvider: provider,
    providerWebhooks: { providerName: provider.name, receiveProviderWebhook },
    // The dev-only mock controls exist only for the mock provider, never in production.
    mockProviderDev:
      selectedProvider instanceof MockPayoutProvider && !config.isProduction
        ? {
            mockProvider: selectedProvider,
            authenticator,
            getTransfer,
            receiveProviderWebhook,
            jobRunner,
            publicApiUrl: config.publicApiUrl,
          }
        : undefined,
    currencyRegistry,
    currencyCatalogue,
    senderCountries,
    customerProfiles: createCustomerProfiles({ profileStore, senderCountries, auditLog, clock }),
    customerOnboarding: createCustomerOnboarding({
      provider,
      customerLinkStore,
      onboardingStateStore,
      profileStore,
      senderCountries,
      findUserEmail,
      notifyIdCheck: async (email, result) => {
        if ('sendIdCheckResult' in mailer) {
          await (mailer as unknown as AccountMailer).sendIdCheckResult(email, result);
        }
      },
      auditLog,
      adminAlerts,
      logger,
      clock,
      publicApiUrl: config.publicApiUrl,
      redirectPolicy: {
        allowedHosts: config.providerRedirectHosts,
        ownOrigin: new URL(config.publicApiUrl).origin,
        isProduction: config.isProduction,
      },
    }),
    twoFactor,
    transferPause,
    transferLimits: config.transferLimits,
    adminAccess,
    adminQueries,
    strictAuditLog: auditLog,
    usdRates: config.admin.usdRates,
    monthlyTargetUsd: config.admin.monthlyTargetUsd,
    confirmPassword: createConfirmPassword({ userAccountStore, passwordHasher }),
    manageUserAccounts: createManageUserAccounts({ userAccountStore, sessionStore, auditLog }),

    requestQuote: createRequestQuote({
      transferPause,
      provider,
      currencyCatalogue,
      customerLinkStore,
      quoteRepository,
      auditLog,
      clock,
    }),
    getRecipientForm: createGetRecipientForm(recipientDeps),
    addRecipient: createAddRecipient(recipientDeps),
    listRecipients: createListRecipients({ recipientRepository }),
    removeRecipient: createRemoveRecipient({ recipientRepository, auditLog }),
    attachRecipientToQuote: createAttachRecipientToQuote({ ...recipientDeps, clock }),
    getTransferDetail: createGetTransferDetail({ transferRepository, recipientRepository }),
    getTransferFunding: createGetTransferFunding(fundingDeps),
    fundTransfer: createFundTransfer(fundingDeps),
    getTransferForm: createGetTransferForm(confirmDeps),
    confirmTransfer: createConfirmTransfer(confirmDeps),
    refreshTransfer: createRefreshTransfer({
      provider,
      customerLinkStore,
      transferRepository,
      applyProviderTransferUpdate,
      clock,
    }),
    listTransfers: createListTransfers({ transferRepository }),
    cancelTransfer: createCancelTransfer({
      provider,
      customerLinkStore,
      transferRepository,
      auditLog,
    }),

    registerUser: createRegisterUser({
      userAccountStore,
      passwordHasher,
      auditLog,
      passwordMinLength: config.auth.passwordMinLength,
      ...emailTokenDeps,
    }),
    loginUser: createLoginUser({
      twoFactor,
      adminAccess,
      userAccountStore,
      passwordHasher,
      sessionService,
      auditLog,
      clock,
      accountLockThreshold: config.auth.accountLockThreshold,
      accountLockMinutes: config.auth.accountLockMinutes,
    }),
    refreshSession: createRefreshSession(sessionService),
    logout: createLogout({ sessionService, sessionStore, auditLog }),
    logoutAll: createLogoutAll({ sessionService, auditLog }),
    verifyEmail: createVerifyEmail({ authTokenStore, userAccountStore, auditLog }),
    resendEmailVerification: createResendEmailVerification(emailTokenDeps),
    requestPasswordReset: createRequestPasswordReset({
      userAccountStore,
      authTokenStore,
      mailer,
      auditLog,
      clock,
      passwordResetTtlMinutes: config.auth.passwordResetTtlMinutes,
      publicAppUrl: config.auth.publicAppUrl,
    }),
    resetPassword: createResetPassword({
      userAccountStore,
      authTokenStore,
      passwordHasher,
      sessionService,
      mailer,
      auditLog,
      passwordMinLength: config.auth.passwordMinLength,
    }),

    adminAlerts,
    background,

    shutdown: async () => {
      await background.stop();
      await pool.end();
    },
  };

  return container;
}
