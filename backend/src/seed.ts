import { createContainer } from './container.ts';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_CUSTOMER_EMAIL,
  DEMO_PASSWORD,
  seedDemoData,
} from './infrastructure/seed/seed-demo-data.ts';

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** `npm run seed` / `node dist/seed.js`: demo data for a local stack. Refused in production. */
async function main(): Promise<void> {
  const container = createContainer({ ...process.env, BACKGROUND_JOBS_ENABLED: 'false' });
  try {
    const report = await seedDemoData(container);
    if (report.alreadySeeded) {
      say('Demo data is already there; nothing changed.');
      return;
    }
    say(`Customer: ${DEMO_CUSTOMER_EMAIL} / ${DEMO_PASSWORD}`);
    say(`Admin:    ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
    say(
      report.adminTotpSecret
        ? `Admin authenticator secret (add it to an authenticator app): ${report.adminTotpSecret}`
        : 'Admin 2FA was not set up (set ENCRYPTION_KEY to enable it).',
    );
  } finally {
    await container.shutdown();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
