import type { Env } from '../../../config/env.ts';
import type { Logger } from '../../../shared/logger.ts';
import type { ProviderTransport } from '../provider-http-client.ts';
import { loadAirwallexConfig } from './airwallex-config.ts';
import { createAirwallexHttpClient } from './airwallex-http.ts';
import { providerTransport } from '../mtls-transport.ts';
import { AirwallexPayoutProvider } from './airwallex-payout-provider.ts';
import { AirwallexTokenProvider } from './airwallex-token-provider.ts';

/** Builds the Airwallex provider, failing fast if its configuration is incomplete. */
export function createAirwallexProvider(deps: {
  env: Env;
  logger: Logger;
  transport?: ProviderTransport;
}): AirwallexPayoutProvider {
  const config = loadAirwallexConfig(deps.env);
  const transport = providerTransport(deps.env, deps.logger, deps.transport);
  const tokens = new AirwallexTokenProvider({
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    apiKey: config.apiKey,
    transport,
    timeoutMs: config.httpTimeoutMs,
  });
  const http = createAirwallexHttpClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.httpTimeoutMs,
    maxRetries: config.httpMaxRetries,
    getAuthToken: () => tokens.getToken(),
    invalidateAuthToken: () => tokens.invalidate(),
    logger: deps.logger,
    transport,
  });
  return new AirwallexPayoutProvider({ config, http });
}
