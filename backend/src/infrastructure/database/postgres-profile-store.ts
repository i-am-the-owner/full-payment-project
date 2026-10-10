import type { ProfileStore } from '../../application/transfer/ports.ts';
import type { CustomerProfile } from '../../domain/payout/models.ts';
import type { DatabasePool } from './pool.ts';

interface ProfileRow {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  country_of_residence: string | null;
  phone: string | null;
}

/** The profile columns on `users`. Personal data: never logged. */
export class PostgresProfileStore implements ProfileStore {
  readonly #pool: DatabasePool;
  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async get(userId: string): Promise<Partial<CustomerProfile>> {
    const { rows } = await this.#pool.query<ProfileRow>(
      `SELECT first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              country_of_residence, phone
       FROM users WHERE id = $1`,
      [userId],
    );
    const row = rows[0];
    return {
      ...(row?.first_name ? { firstName: row.first_name } : {}),
      ...(row?.last_name ? { lastName: row.last_name } : {}),
      ...(row?.date_of_birth ? { dateOfBirth: row.date_of_birth } : {}),
      ...(row?.country_of_residence ? { countryOfResidence: row.country_of_residence } : {}),
      ...(row?.phone ? { phone: row.phone } : {}),
    };
  }

  async save(userId: string, profile: CustomerProfile): Promise<void> {
    await this.#pool.query(
      `UPDATE users SET first_name = $2, last_name = $3, date_of_birth = $4::date,
              country_of_residence = $5, phone = $6
       WHERE id = $1`,
      [
        userId,
        profile.firstName,
        profile.lastName,
        profile.dateOfBirth,
        profile.countryOfResidence,
        profile.phone,
      ],
    );
  }
}
