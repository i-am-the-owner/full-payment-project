import type { AuditLog } from '../../application/audit/audit-log.ts';
import type { PayoutProvider } from '../../application/payout/payout-provider.ts';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../shared/logger.ts';
import { createAirwallexProvider } from './airwallex/create-airwallex-provider.ts';
import { createCurrencycloudProvider } from './currencycloud/currencycloud-payout-provider.ts';
import { MockPayoutProvider } from './mock/mock-payout-provider.ts';
import { assertEnvironmentPolicy } from './environment-policy.ts';
import { createWiseProvider } from './wise/create-wise-provider.ts';
import type { RefreshTokenStore } from './wise/wise-user-tokens.ts';

export interface PayoutProviderDeps {
  readonly env: Env;
  readonly logger: Logger;
  readonly auditLog: AuditLog;
  /** Minor-unit exponent for a currency; must throw for an unknown one. */
  readonly currencyMinorUnits: (currency: string) => number | Promise<number>;
  /** Where partner OAuth keeps customers' refresh tokens (encrypted by the store). */
  readonly refreshTokens?: RefreshTokenStore;
}

/**
 * Builds the provider chosen by `PAYOUT_PROVIDER`. The only place a concrete
 * provider is constructed. Throws {@link ProviderConfigError} at startup when
 * the chosen provider's required variables are missing.
 */
export function createPayoutProvider(deps: PayoutProviderDeps): PayoutProvider {
  const { env } = deps;
  // Production refuses mock/sandbox; staging and development refuse live keys.
  assertEnvironmentPolicy(env);
  switch (env.PAYOUT_PROVIDER) {
    case 'mock':
      return new MockPayoutProvider({
        ...(env.MOCK_WEBHOOK_SECRET ? { webhookSecret: env.MOCK_WEBHOOK_SECRET } : {}),
        skipIdentityCheck: env.MOCK_SKIP_IDENTITY_CHECK,
      });
    case 'wise':
      return createWiseProvider(deps);
    case 'airwallex':
      return createAirwallexProvider({ env, logger: deps.logger });
    case 'currencycloud':
      return createCurrencycloudProvider(env);
  }
}
