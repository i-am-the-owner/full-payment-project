/**
 * Starts the real API for the browser tests: migrates a database, loads the demo
 * data (mock provider) and serves on E2E_PORT. The demo admin's authenticator
 * secret is written to E2E_SECRET_FILE so the test can sign in with two-step.
 *
 *   DATABASE_URL=... E2E_PORT=3100 E2E_SECRET_FILE=/tmp/secret node e2e/server.ts
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContainer } from '../src/container.ts';
import { createApp } from '../src/interfaces/http/create-app.ts';
import { loadMigrations, migrate } from '../src/infrastructure/database/migrator.ts';
import { seedDemoData } from '../src/infrastructure/seed/seed-demo-data.ts';

// This server WIPES the database it is given. Only a database that says it is a test one is accepted.
const dbName = new URL(process.env.DATABASE_URL ?? 'postgres://x/none').pathname;
if (!/test|e2e/i.test(dbName)) {
  throw new Error(`Refusing to wipe database "${dbName}": its name must contain "test" or "e2e".`);
}

const port = Number(process.env.E2E_PORT ?? 3100);
const container = createContainer({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PAYOUT_PROVIDER: 'mock',
  DASHBOARD_USD_RATES: 'GBP:1.27',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  BACKGROUND_JOBS_ENABLED: 'false',
});
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
await migrate(container.pool, await loadMigrations(migrations), { info: () => {} });
// A clean slate on every run.
await container.pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
await container.pool
  .query('TRUNCATE transfer_quotes, webhook_events, audit_events CASCADE')
  .catch(() => {});
const report = await seedDemoData(container);
if (report.adminTotpSecret && process.env.E2E_SECRET_FILE) {
  writeFileSync(process.env.E2E_SECRET_FILE, report.adminTotpSecret, { mode: 0o600 });
}
createApp(container).listen(port, () => process.stdout.write(`e2e server on ${port}\n`));
