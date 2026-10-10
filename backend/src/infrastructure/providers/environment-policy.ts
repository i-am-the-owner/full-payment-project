import type { Env } from '../../config/env.ts';
import { ProviderConfigError } from './provider-config-error.ts';
import { loadWiseConfig } from './wise/wise-config.ts';
import { loadAirwallexConfig } from './airwallex/airwallex-config.ts';

export type AppEnvironment = 'development' | 'staging' | 'production';
/** What the configured provider would do with money. */
export type ProviderMode = 'mock' | 'sandbox' | 'production';

/**
 * Which deployment this is. `APP_ENV` says it; without it, NODE_ENV=production
 * means production and anything else means development, so an old deployment
 * that only sets NODE_ENV keeps its current (strict) behaviour.
 */
export function resolveAppEnvironment(env: Env): AppEnvironment {
  return env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'development');
}

/** Classifies the configured provider as mock, sandbox or production from its own config. */
export function providerMode(env: Env): ProviderMode {
  switch (env.PAYOUT_PROVIDER) {
    case 'mock':
      return 'mock';
    case 'wise':
      return loadWiseConfig(env).isSandbox ? 'sandbox' : 'production';
    case 'airwallex':
      return loadAirwallexConfig(env).isSandbox ? 'sandbox' : 'production';
    case 'currencycloud': {
      // Currencycloud's demo API is devapi.currencycloud.com; any other host is live.
      // With no URL set the provider's own config check reports the missing variable.
      if (!env.CURRENCYCLOUD_API_BASE_URL) return 'sandbox';
      const host = new URL(env.CURRENCYCLOUD_API_BASE_URL).hostname;
      return /^devapi\.|demo|sandbox|localhost|127\.0\.0\.1|\.invalid$/.test(host)
        ? 'sandbox'
        : 'production';
    }
  }
}

/**
 * Refuses a deployment whose provider does not match its environment:
 *
 * - production: must use a live provider. A mock or sandbox provider moves no
 *   real money, so it is refused unless ALLOW_NON_PROD_PROVIDER=true (for a
 *   deliberate dry run). The flag is reported in the log.
 * - staging and development: must NOT use live provider credentials or hosts,
 *   whatever any flag says.
 * - staging and production run with NODE_ENV=production (all hardening on);
 *   development must not.
 */
export function assertEnvironmentPolicy(env: Env): {
  environment: AppEnvironment;
  mode: ProviderMode;
} {
  const environment = resolveAppEnvironment(env);
  const problems: string[] = [];

  if (environment === 'development' && env.NODE_ENV === 'production') {
    problems.push('APP_ENV=development cannot be used with NODE_ENV=production.');
  }
  if (environment !== 'development' && env.NODE_ENV !== 'production') {
    problems.push(`APP_ENV=${environment} needs NODE_ENV=production (all hardening on).`);
  }

  const mode = providerMode(env);
  if (environment === 'production' && mode !== 'production' && !env.ALLOW_NON_PROD_PROVIDER) {
    problems.push(
      `APP_ENV=production with a ${mode} provider (PAYOUT_PROVIDER=${env.PAYOUT_PROVIDER}) moves ` +
        'no real money. Use live provider credentials, or set ALLOW_NON_PROD_PROVIDER=true for a deliberate dry run.',
    );
  }
  if (environment !== 'production' && mode === 'production') {
    problems.push(
      `APP_ENV=${environment} refuses live provider credentials or hosts (PAYOUT_PROVIDER=${env.PAYOUT_PROVIDER}). ` +
        'Use the provider sandbox here.',
    );
  }

  if (problems.length > 0) {
    throw new ProviderConfigError(`Environment policy:\n  - ${problems.join('\n  - ')}`);
  }
  return { environment, mode };
}
