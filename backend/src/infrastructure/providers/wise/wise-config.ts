import type { Env } from '../../../config/env.ts';
import { ProviderConfigError } from '../provider-config-error.ts';

/**
 * Configuration for the Wise adapter. All values are backend-only and come from
 * the environment / secrets manager – never from committed files and never
 * shipped to a client.
 *
 * There is deliberately no profile id here: every Wise call is made for a
 * customer's own linked profile (the `customerRef` of their provider link),
 * never a shared SomPay business profile.
 */
export type WiseAuthMode = 'personal_token' | 'oauth_partner';

export interface WiseConfig {
  readonly authMode: WiseAuthMode;
  readonly baseUrl: string;
  /** Dated API version for the newer endpoints (e.g. `2026Q4`). */
  readonly apiVersion: string;
  /** oauth_partner: where the customer authorises SomPay, and the registered redirect URI. */
  readonly authorizeUrl: string | undefined;
  readonly oauthRedirectUri: string | undefined;
  /** Currencies customers may pay in. */
  readonly sourceCurrencies: readonly string[];
  readonly httpTimeoutMs: number;
  readonly httpMaxRetries: number;
  /** OAuth client credentials, when the integration authenticates that way. */
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  /** A pre-issued bearer token, when onboarding supplied one directly. */
  readonly apiToken: string | undefined;
  /** PEM of the RSA public key used to verify inbound webhook signatures. */
  readonly webhookPublicKeyPem: string;
  /** PEM of SomPay's RSA private key for signing SCA one-time-tokens. */
  readonly scaPrivateKeyPem: string | undefined;
  /** True when talking to a non-production Wise host. */
  readonly isSandbox: boolean;
}

const SANDBOX_BASE_URL = 'https://api.wise-sandbox.com';
// Only these hosts are treated as sandbox. EVERY other host (including Wise's
// production mTLS host, api-mtls.transferwise.com) gets the strict production
// rules, so an unfamiliar address can never pick up the sandbox's relaxed ones.
const SANDBOX_HOSTS = new Set([
  'api.sandbox.transferwise.tech',
  'api.wise-sandbox.com',
  'api-mtls.wise-sandbox.com',
  'localhost',
  '127.0.0.1',
]);

// Wise's published sandbox webhook public key (a public value – safe to commit).
// Source: Wise Platform API docs, "Webhook events / signature verification".
const WISE_SANDBOX_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwpb91cEYuyJNQepZAVfP
ZIlPZfNUefH+n6w9SW3fykqKu938cR7WadQv87oF2VuT+fDt7kqeRziTmPSUhqPU
ys/V2Q1rlfJuXbE+Gga37t7zwd0egQ+KyOEHQOpcTwKmtZ81ieGHynAQzsn1We3j
wt760MsCPJ7GMT141ByQM+yW1Bx+4SG3IGjXWyqOWrcXsxAvIXkpUD/jK/L958Cg
nZEgz0BSEh0QxYLITnW1lLokSx/dTianWPFEhMC9BgijempgNXHNfcVirg1lPSyg
z7KqoKUN0oHqWLr2U1A+7kqrl6O2nx3CKs1bj1hToT1+p4kcMoHXA7kA+VBLUpEs
VwIDAQAB
-----END PUBLIC KEY-----`;

/** Kept as an alias so callers can catch Wise configuration problems by name. */
export class WiseConfigError extends ProviderConfigError {}

/** Builds {@link WiseConfig}, failing fast on an unsafe or incomplete setup. */
export function loadWiseConfig(env: Env): WiseConfig {
  const baseUrl = env.WISE_API_BASE_URL ?? SANDBOX_BASE_URL;
  const url = new URL(baseUrl);
  const isProductionHost = !SANDBOX_HOSTS.has(url.hostname);

  if (isProductionHost && !env.WISE_ALLOW_PRODUCTION) {
    throw new WiseConfigError(
      `WISE_API_BASE_URL points at a production Wise host (${url.hostname}). ` +
        `Set WISE_ALLOW_PRODUCTION=true to permit it.`,
    );
  }
  if (isProductionHost && env.NODE_ENV !== 'production') {
    throw new WiseConfigError(
      `WISE_API_BASE_URL points at a production Wise host (${url.hostname}) but NODE_ENV is ` +
        `"${env.NODE_ENV}". Production Wise may only be used with NODE_ENV=production.`,
    );
  }
  if (isProductionHost && !env.WISE_WEBHOOK_PUBLIC_KEY) {
    // The bundled key is Wise's SANDBOX key: it must never verify production webhooks.
    throw new WiseConfigError(
      'WISE_WEBHOOK_PUBLIC_KEY must be set explicitly when using a production Wise host.',
    );
  }

  const authMode = env.WISE_AUTH_MODE;
  if (authMode === 'personal_token') {
    if (!env.WISE_API_TOKEN) {
      throw new WiseConfigError(
        'WISE_AUTH_MODE=personal_token needs WISE_API_TOKEN (a sandbox personal token). ' +
          'For partner credentials set WISE_AUTH_MODE=oauth_partner with ' +
          'WISE_CLIENT_ID + WISE_CLIENT_SECRET.',
      );
    }
    if (isProductionHost) {
      // One personal token is one Wise account: every customer would be the same sender.
      throw new WiseConfigError(
        'WISE_AUTH_MODE=personal_token is for the sandbox only. Production needs ' +
          'WISE_AUTH_MODE=oauth_partner, so each customer has their own Wise account.',
      );
    }
  } else {
    if (!env.WISE_CLIENT_ID || !env.WISE_CLIENT_SECRET) {
      throw new WiseConfigError(
        'WISE_AUTH_MODE=oauth_partner needs WISE_CLIENT_ID and WISE_CLIENT_SECRET.',
      );
    }
    if (!env.WISE_AUTHORIZE_URL || !env.WISE_AUTHORIZE_URL.startsWith('https://')) {
      throw new WiseConfigError(
        'WISE_AUTH_MODE=oauth_partner needs WISE_AUTHORIZE_URL (an https address from the Wise team).',
      );
    }
  }

  return {
    authMode,
    apiVersion: env.WISE_API_VERSION,
    authorizeUrl: env.WISE_AUTHORIZE_URL,
    oauthRedirectUri:
      env.WISE_OAUTH_REDIRECT_URI ??
      `${(env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '')}/api/v1/onboarding/callback`,
    sourceCurrencies: env.WISE_SOURCE_CURRENCIES.split(','),
    baseUrl: baseUrl.replace(/\/+$/, ''),
    httpTimeoutMs: env.PAYOUT_HTTP_TIMEOUT_MS,
    httpMaxRetries: env.PAYOUT_HTTP_MAX_RETRIES,
    clientId: env.WISE_CLIENT_ID,
    clientSecret: env.WISE_CLIENT_SECRET,
    apiToken: env.WISE_API_TOKEN,
    webhookPublicKeyPem: env.WISE_WEBHOOK_PUBLIC_KEY ?? WISE_SANDBOX_WEBHOOK_PUBLIC_KEY,
    scaPrivateKeyPem: env.WISE_SCA_PRIVATE_KEY,
    isSandbox: !isProductionHost,
  };
}
