# Database operations

PostgreSQL 14+. Schema reference: [`schema.md`](schema.md). Design rationale:
[`../architecture/adr/0006-database-and-migrations.md`](../architecture/adr/0006-database-and-migrations.md).

## Local PostgreSQL

Any PostgreSQL 14+ works. A disposable local instance with Docker:

```bash
docker run -d --name almapay-pg \
  -e POSTGRES_USER=almapay \
  -e POSTGRES_PASSWORD=almapay \
  -e POSTGRES_DB=almapay_dev \
  -p 5432:5432 \
  postgres:16-alpine
```

This matches the default `DATABASE_URL` in `backend/.env.example`:

```
DATABASE_URL=postgres://almapay:almapay@localhost:5432/almapay_dev
```

Never point local development at a real database, and never load real customer
data (core security rules 12–13).

## Migrations

Migrations live in `backend/migrations/` as `NNNN_name.sql` files, each with a
`-- migrate:up` and a `-- migrate:down` section. They run in version order, each
in its own transaction, and are tracked in `schema_migrations` with a checksum.

```bash
cd backend

npm run db:migrate     # apply all pending migrations
npm run db:status      # show applied / pending
npm run db:rollback    # revert the most recently applied migration
```

The CLI reads `DATABASE_URL` (from `.env` in development, from the environment
otherwise).

### Adding a migration

1. Create `backend/migrations/NNNN_short_name.sql` with the next number.
2. Write the `-- migrate:up` and `-- migrate:down` SQL.
3. `npm run db:migrate`, then `npm run db:rollback` and `npm run db:migrate`
   again to prove the down section works.
4. **Never edit a migration that has been applied anywhere** — the checksum check
   will refuse it. Write a new migration instead.

Enum-like `TEXT` columns use `CHECK (... IN (...))`. To change the allowed set,
add a migration that drops and recreates the check constraint.

## Tests

`backend/test/integration/database/schema.test.ts` applies every migration to a
real database and verifies the constraints, triggers and state machine. It runs
only when `DATABASE_URL` is set:

```bash
cd backend
DATABASE_URL=postgres://almapay:almapay@localhost:5432/almapay_dev npm test
```

Without `DATABASE_URL` the database suite is skipped and the rest of the tests
run normally.
