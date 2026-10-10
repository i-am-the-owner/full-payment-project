import type { AuditLog } from '../../../application/audit/audit-log.ts';
import type { Env } from '../../../config/env.ts';
import type { Logger } from '../../../shared/logger.ts';
import { providerTransport } from '../mtls-transport.ts';
import { ProviderConfigError } from '../provider-config-error.ts';
import { WiseApiClient, type CurrencyMinorUnits } from './wise-api-client.ts';
import { loadWiseConfig, type WiseConfig } from './wise-config.ts';
import type { WiseGateway } from './wise-gateway.ts';
import { WiseHttpClient, type WiseTransport } from './wise-http-client.ts';
import { WisePayoutProvider } from './wise-payout-provider.ts';
import { WiseScaSigner } from './wise-sca-signer.ts';
import {
  ClientCredentialsWiseTokenProvider,
  StaticWiseTokenProvider,
  type WiseTokenProvider,
} from './wise-token-provider.ts';
import { WiseUserTokenManager, type RefreshTokenStore } from './wise-user-tokens.ts';
import { RsaWiseWebhookVerifier } from './wise-webhook-verifier.ts';

export interface WiseProviderDeps {
  readonly env: Env;
  readonly logger: Logger;
  readonly auditLog: AuditLog;
  readonly currencyMinorUnits: CurrencyMinorUnits;
  readonly transport?: WiseTransport;
  /** Where partner OAuth keeps each customer's refresh token (encrypted by the store). */
  readonly refreshTokens?: RefreshTokenStore;
}

/** Builds the Wise provider, failing fast if its configuration is incomplete. */
export function createWiseProvider(deps: WiseProviderDeps): WisePayoutProvider {
  const config = loadWiseConfig(deps.env);
  // Presents the mTLS client certificate when one is configured.
  const transport = providerTransport(deps.env, deps.logger, deps.transport);

  const scaSigner = config.scaPrivateKeyPem
    ? new WiseScaSigner(config.scaPrivateKeyPem)
    : undefined;

  const httpFor = (
    getAuthToken: () => Promise<string>,
    invalidateAuthToken: () => void,
  ): WiseHttpClient =>
    new WiseHttpClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.httpTimeoutMs,
      maxRetries: config.httpMaxRetries,
      getAuthToken,
      invalidateAuthToken,
      logger: deps.logger,
      transport,
    });
  const apiFor = (http: WiseHttpClient, profileId: string): WiseGateway =>
    new WiseApiClient({
      http,
      profileId,
      isSandbox: config.isSandbox,
      auditLog: deps.auditLog,
      currencyMinorUnits: deps.currencyMinorUnits,
      apiVersion: config.apiVersion,
      ...(scaSigner ? { scaSigner } : {}),
    });

  const webhookVerifier = new RsaWiseWebhookVerifier(config.webhookPublicKeyPem);

  if (config.authMode === 'personal_token') {
    const token = new StaticWiseTokenProvider(config.apiToken ?? '');
    const http = httpFor(
      () => token.getToken(),
      () => token.invalidate(),
    );
    return new WisePayoutProvider({
      mode: 'personal_token',
      clientFor: (profileId) => apiFor(http, profileId),
      appClient: () => apiFor(http, '0'),
      sourceCurrencies: config.sourceCurrencies,
      webhookVerifier,
    });
  }

  return createPartnerProvider(deps, config, transport, httpFor, apiFor, webhookVerifier);
}

/** Partner OAuth. NOT YET TESTED against Wise: there are no partner credentials yet. */
function createPartnerProvider(
  deps: WiseProviderDeps,
  config: WiseConfig,
  transport: WiseTransport,
  httpFor: (get: () => Promise<string>, invalidate: () => void) => WiseHttpClient,
  apiFor: (http: WiseHttpClient, profileId: string) => WiseGateway,
  webhookVerifier: RsaWiseWebhookVerifier,
): WisePayoutProvider {
  if (!deps.refreshTokens) {
    throw new ProviderConfigError(
      "WISE_AUTH_MODE=oauth_partner needs a store for customers' refresh tokens.",
    );
  }
  const clientId = config.clientId ?? '';
  const clientSecret = config.clientSecret ?? '';
  const tokens = new WiseUserTokenManager({
    baseUrl: config.baseUrl,
    clientId,
    clientSecret,
    transport,
    timeoutMs: config.httpTimeoutMs,
    store: deps.refreshTokens,
  });

  // App-level calls (the currency list) use a client-credentials token.
  const appToken: WiseTokenProvider = new ClientCredentialsWiseTokenProvider({
    baseUrl: config.baseUrl,
    clientId,
    clientSecret,
    transport,
    timeoutMs: config.httpTimeoutMs,
  });
  const appHttp = httpFor(
    () => appToken.getToken(),
    () => appToken.invalidate(),
  );

  // One HTTP client per customer: each uses that customer's own access token.
  const customerHttp = new Map<string, WiseHttpClient>();
  const httpForCustomer = (customerRef: string): WiseHttpClient => {
    let http = customerHttp.get(customerRef);
    if (!http) {
      http = httpFor(
        () => tokens.accessTokenFor(customerRef),
        () => tokens.invalidate(customerRef),
      );
      customerHttp.set(customerRef, http);
    }
    return http;
  };

  return new WisePayoutProvider({
    mode: 'oauth_partner',
    clientFor: (profileId, customerRef) =>
      apiFor(customerRef ? httpForCustomer(customerRef) : appHttp, profileId),
    appClient: () => apiFor(appHttp, '0'),
    sourceCurrencies: config.sourceCurrencies,
    webhookVerifier,
    oauth: {
      authorizeUrl: config.authorizeUrl ?? '',
      clientId,
      redirectUri: config.oauthRedirectUri ?? '',
      tokens,
      // Before the token belongs to a known customer: a one-off client with it.
      listProfilesWith: (accessToken) => {
        const once = httpFor(
          () => Promise.resolve(accessToken),
          () => undefined,
        );
        return apiFor(once, '0').listProfiles();
      },
    },
  });
}
