import { parseEnv } from '../../src/config/env.ts';
import { loadAirwallexConfig } from '../../src/infrastructure/providers/airwallex/airwallex-config.ts';
import { createAirwallexHttpClient } from '../../src/infrastructure/providers/airwallex/airwallex-http.ts';
import { AirwallexPayoutProvider } from '../../src/infrastructure/providers/airwallex/airwallex-payout-provider.ts';
import { AirwallexTokenProvider } from '../../src/infrastructure/providers/airwallex/airwallex-token-provider.ts';
import { createLogger } from '../../src/shared/logger.ts';
import { handlerTransport, type FakeResponseSpec, type RecordedRequest } from './wise-fakes.ts';

export const AWX_ENV = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/almapay',
  JWT_SECRET: 'a'.repeat(40),
  PAYOUT_PROVIDER: 'airwallex',
  AIRWALLEX_CLIENT_ID: 'client-id-123',
  AIRWALLEX_API_KEY: 'API-KEY-SECRET-9f8e7d',
  AIRWALLEX_WEBHOOK_SECRET: 'whsec-test-secret',
};

export const ACCESS_TOKEN = 'ACCESS-TOKEN-SECRET-1a2b3c';
export const NOW = new Date('2026-10-03T12:00:00Z');
export const LINK = { provider: 'airwallex' as const, customerRef: 'acct_customer_1' };

export interface AwxRoute {
  (
    req: RecordedRequest & { path: string; json: Record<string, unknown> },
  ): FakeResponseSpec | undefined;
}

/**
 * An Airwallex provider wired to a fake transport. The login call is answered
 * automatically; `route` handles everything else and may return `undefined`
 * for a 404.
 */
export function buildAirwallex(route: AwxRoute, envOverrides: Record<string, string> = {}) {
  const logLines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (_level, line) => logLines.push(line) });
  const { transport, requests } = handlerTransport((req) => {
    const path = new URL(req.url).pathname + new URL(req.url).search;
    if (path === '/api/v1/authentication/login') {
      return { status: 201, body: { token: ACCESS_TOKEN, expires_at: '2026-10-03T12:30:00+0000' } };
    }
    const json = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
    return route({ ...req, path, json }) ?? { status: 404, body: { code: 'not_found' } };
  });
  const config = loadAirwallexConfig(parseEnv({ ...AWX_ENV, ...envOverrides }));
  const tokens = new AirwallexTokenProvider({
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    apiKey: config.apiKey,
    transport,
    timeoutMs: 5_000,
    now: () => NOW.getTime(),
  });
  const http = createAirwallexHttpClient({
    baseUrl: config.baseUrl,
    timeoutMs: 5_000,
    maxRetries: 2,
    getAuthToken: () => tokens.getToken(),
    invalidateAuthToken: () => tokens.invalidate(),
    logger,
    transport,
    sleep: () => Promise.resolve(),
  });
  const provider = new AirwallexPayoutProvider({ config, http, clock: () => NOW });
  /** Requests other than the login call. */
  const apiRequests = (): RecordedRequest[] =>
    requests.filter((r) => !r.url.endsWith('/authentication/login'));
  return { provider, requests, apiRequests, logLines, config, tokens };
}
