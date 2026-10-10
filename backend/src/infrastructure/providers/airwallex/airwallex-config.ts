import type { Env } from '../../../config/env.ts';
import { ProviderConfigError } from '../provider-config-error.ts';

/**
 * Configuration for the Airwallex adapter. Backend-only: every value comes from
 * the environment / secret manager and none may reach a client.
 */
export interface AirwallexConfig {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly apiKey: string;
  /** Secret of the webhook notification URL. Without it no webhook is accepted. */
  readonly webhookSecret: string | undefined;
  /** Sent as `x-api-version` so status names do not change under us. */
  readonly apiVersion: string;
  readonly hostedFlowTemplateId: string | undefined;
  readonly onboardingReturnUrl: string | undefined;
  readonly onboardingErrorUrl: string | undefined;
  readonly legalEntityType: 'INDIVIDUAL' | 'BUSINESS';
  readonly accountCountry: string;
  readonly sourceCurrencies: readonly string[];
  readonly httpTimeoutMs: number;
  readonly httpMaxRetries: number;
  readonly isSandbox: boolean;
}

// Source: Airwallex API reference, "API endpoints" table.
const SANDBOX_BASE_URL = 'https://api.sandbox.airwallex.com';
// Only these hosts are sandbox; every other host gets the strict production rules.
const SANDBOX_HOSTS = new Set(['api.sandbox.airwallex.com', 'localhost', '127.0.0.1']);

/** Builds {@link AirwallexConfig}, failing fast on an unsafe or incomplete setup. */
export function loadAirwallexConfig(env: Env): AirwallexConfig {
  const missing = (['AIRWALLEX_CLIENT_ID', 'AIRWALLEX_API_KEY'] as const).filter(
    (key) => !env[key],
  );
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `PAYOUT_PROVIDER=airwallex but these variables are not set: ${missing.join(', ')}.`,
    );
  }

  const baseUrl = env.AIRWALLEX_BASE_URL ?? SANDBOX_BASE_URL;
  const hostname = new URL(baseUrl).hostname;
  const isProductionHost = !SANDBOX_HOSTS.has(hostname);
  if (isProductionHost && !env.AIRWALLEX_ALLOW_PRODUCTION) {
    throw new ProviderConfigError(
      `AIRWALLEX_BASE_URL points at the production Airwallex host (${hostname}). ` +
        `Set AIRWALLEX_ALLOW_PRODUCTION=true to permit it.`,
    );
  }
  if (isProductionHost && env.NODE_ENV !== 'production') {
    throw new ProviderConfigError(
      `AIRWALLEX_BASE_URL points at the production Airwallex host but NODE_ENV is ` +
        `"${env.NODE_ENV}". Production Airwallex may only be used with NODE_ENV=production.`,
    );
  }
  if (isProductionHost && !env.AIRWALLEX_WEBHOOK_SECRET) {
    throw new ProviderConfigError(
      'AIRWALLEX_WEBHOOK_SECRET must be set when using the production Airwallex host.',
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    clientId: env.AIRWALLEX_CLIENT_ID ?? '',
    apiKey: env.AIRWALLEX_API_KEY ?? '',
    webhookSecret: env.AIRWALLEX_WEBHOOK_SECRET,
    apiVersion: env.AIRWALLEX_API_VERSION,
    hostedFlowTemplateId: env.AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID,
    onboardingReturnUrl: env.AIRWALLEX_ONBOARDING_RETURN_URL,
    onboardingErrorUrl: env.AIRWALLEX_ONBOARDING_ERROR_URL,
    legalEntityType: env.AIRWALLEX_LEGAL_ENTITY_TYPE,
    accountCountry: env.AIRWALLEX_ACCOUNT_COUNTRY,
    sourceCurrencies: env.AIRWALLEX_SOURCE_CURRENCIES.split(','),
    httpTimeoutMs: env.PAYOUT_HTTP_TIMEOUT_MS,
    httpMaxRetries: env.PAYOUT_HTTP_MAX_RETRIES,
    isSandbox: !isProductionHost,
  };
}
