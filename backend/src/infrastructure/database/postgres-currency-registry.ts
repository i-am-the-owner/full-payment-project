import { UnknownCurrencyError, type CurrencyRegistry } from '../../application/transfer/ports.ts';
import type { Currency } from '../../domain/payout/models.ts';
import type { DatabasePool } from './pool.ts';

/** The local copy of the currencies the provider reported. */
export class PostgresCurrencyRegistry implements CurrencyRegistry {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async minorUnitExponent(currency: string): Promise<number> {
    const { rows } = await this.#pool.query<{ minor_unit: number | string }>(
      `SELECT minor_unit FROM currencies WHERE code = $1`,
      [currency.toUpperCase()],
    );
    const row = rows[0];
    if (!row) {
      // Never guess: a wrong exponent mis-scales the amount by 10x or more.
      throw new UnknownCurrencyError(currency);
    }
    return Number(row.minor_unit);
  }

  async upsertMany(currencies: readonly Currency[]): Promise<void> {
    if (currencies.length === 0) {
      return;
    }
    await this.#pool.query(
      `INSERT INTO currencies (code, name, minor_unit, is_active)
       SELECT code, name, minor_unit, TRUE
       FROM unnest($1::text[], $2::text[], $3::smallint[]) AS t(code, name, minor_unit)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, minor_unit = EXCLUDED.minor_unit`,
      [
        currencies.map((c) => c.code),
        currencies.map((c) => c.name),
        currencies.map((c) => c.minorUnit),
      ],
    );
  }
}
