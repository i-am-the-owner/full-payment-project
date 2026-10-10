import type { Env } from '../../../config/env.ts';
import { NotImplementedPayoutProvider } from '../not-implemented-provider.ts';
import { ProviderConfigError } from '../provider-config-error.ts';

const REQUIRED = [
  'CURRENCYCLOUD_API_BASE_URL',
  'CURRENCYCLOUD_LOGIN_ID',
  'CURRENCYCLOUD_API_KEY',
] as const;

/**
 * Currencycloud – a documented stub. It makes NO call to the Currencycloud API:
 * every operation throws `NotImplementedError` and no webhook is accepted.
 *
 * docs/CURRENCYCLOUD.md lists which Currencycloud API would implement each
 * `PayoutProvider` operation when this adapter is built.
 */
export class CurrencycloudPayoutProvider extends NotImplementedPayoutProvider {
  constructor() {
    super('currencycloud');
  }
}

/** Validates the configuration at startup so a misconfigured deployment fails early. */
export function createCurrencycloudProvider(env: Env): CurrencycloudPayoutProvider {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `PAYOUT_PROVIDER=currencycloud but these variables are not set: ${missing.join(', ')}.`,
    );
  }
  return new CurrencycloudPayoutProvider();
}
