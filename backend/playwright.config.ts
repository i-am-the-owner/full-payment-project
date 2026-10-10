import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const secretFile = process.env.E2E_SECRET_FILE ?? '/tmp/almapay-e2e-secret';
process.env.E2E_SECRET_FILE = secretFile;

/**
 * Browser tests for the admin console against the real API, a real Postgres
 * (DATABASE_URL) and the mock provider. Run: `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone-375', use: { viewport: { width: 375, height: 700 } } },
  ],
  webServer: {
    command: 'node e2e/server.ts',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(port), E2E_SECRET_FILE: secretFile },
  },
});
