import type { Capabilities, Currency } from '../../domain/payout/models.ts';
import { UnknownCurrencyError, type CurrencyRegistry } from '../transfer/ports.ts';
import type { PayoutProvider } from './payout-provider.ts';

export interface CurrencySnapshot {
  readonly capabilities: Capabilities;
  readonly currencies: readonly Currency[];
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * What the provider supports, fetched at runtime and cached briefly. Countries
 * and currencies are never hard-coded: this is the only source for them. Each
 * refresh is also written to the local `currencies` table so stored quotes and
 * transfers can be formatted without calling the provider.
 */
export class CurrencyCatalogue {
  readonly #provider: PayoutProvider;
  readonly #registry: CurrencyRegistry;
  readonly #clock: () => Date;
  readonly #ttlMs: number;
  #cache: { snapshot: CurrencySnapshot; fetchedAt: number } | undefined;

  constructor(deps: {
    provider: PayoutProvider;
    currencyRegistry: CurrencyRegistry;
    clock: () => Date;
    ttlMs?: number;
  }) {
    this.#provider = deps.provider;
    this.#registry = deps.currencyRegistry;
    this.#clock = deps.clock;
    this.#ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  async get(): Promise<CurrencySnapshot> {
    const now = this.#clock().getTime();
    if (this.#cache && now - this.#cache.fetchedAt < this.#ttlMs) {
      return this.#cache.snapshot;
    }
    const [capabilities, currencies] = await Promise.all([
      this.#provider.getCapabilities(),
      this.#provider.listCurrencies(),
    ]);
    await this.#registry.upsertMany(currencies);
    const snapshot = { capabilities, currencies };
    this.#cache = { snapshot, fetchedAt: now };
    return snapshot;
  }

  /** @throws {UnknownCurrencyError} if the provider does not list the currency. */
  async minorUnitExponent(currency: string): Promise<number> {
    const { currencies } = await this.get();
    const found = currencies.find((c) => c.code === currency);
    if (!found) {
      throw new UnknownCurrencyError(currency);
    }
    return found.minorUnit;
  }
}
