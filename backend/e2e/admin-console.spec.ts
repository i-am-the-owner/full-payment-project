import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const ADMIN = { email: 'admin@almapay.test', password: 'demo-password-123' };

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the same as an authenticator app. */
function totp(secretBase32: string, offsetSteps = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretBase32.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 30_000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** The service refuses a code at or before the last one used (as it should). Tests sign in many times in one 30 s step, so rewind that bookkeeping. */
async function freshStep(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `UPDATE user_auth SET totp_last_counter = NULL WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [ADMIN.email],
    );
  } finally {
    await pool.end();
  }
}

async function signIn(page: Page, code: string): Promise<void> {
  await freshStep();
  await page.goto('/admin-console/');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByLabel(/Two-step code/).fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.configure({ mode: 'serial' });

test('the page loads with no console errors or CSP violations, and shows the sign-in form', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/admin-console/');
  await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a wrong code is refused and nothing of the console is shown', async ({ page }) => {
  await signIn(page, '000000');
  await expect(page.getByText('Sign in failed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toBeHidden();
});

test('sign in with two-step, search a user, open a transfer, and see the dashboard, limits and pause switch', async ({
  page,
}, info) => {
  const secret = readFileSync(process.env.E2E_SECRET_FILE!, 'utf8').trim();
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));

  // The seed used the previous time step for enrolment; the current one is free.
  await signIn(page, totp(secret));
  await expect(page.getByRole('heading', { name: 'This month vs target' })).toBeVisible();
  // Dashboard: limits and the pause state are visible.
  await expect(page.getByText(/Per transfer GBP 5,000/)).toBeVisible();
  await expect(page.getByText('New transfers are running')).toBeVisible();

  // Users: search by email, open the profile.
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByPlaceholder('Email, name or user id').fill('demo@');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('cell', { name: 'demo@almapay.test' }).click();
  await expect(page.getByRole('heading', { name: 'demo@almapay.test' })).toBeVisible();
  await expect(page.getByText('Provider link and KYC')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'VERIFIED' })).toBeVisible();

  // Transfers: filter to completed, open one, read the timeline.
  await page.getByRole('button', { name: 'Transfers', exact: true }).click();
  await page.locator('select').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('heading', { name: /^Transfer ALM-SEED/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(
    page.getByText('Read-only: an admin cannot change amounts or statuses.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Webhook history' })).toBeVisible();

  // Reports.
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stuck for 24h+ (not final)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity mismatch reviews' })).toBeVisible();

  // No horizontal scroll at this viewport.
  const overflow = await page.evaluate<number>(
    'document.documentElement.scrollWidth - window.innerWidth',
  );
  expect(overflow, `horizontal overflow at ${info.project.name}`).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('pausing new transfers from the console needs a fresh two-step code', async ({ page }) => {
  const secret = readFileSync(process.env.E2E_SECRET_FILE!, 'utf8').trim();
  // The previous test used this step's code; the service refuses a code used twice, so use the next step.
  await signIn(page, totp(secret));
  await expect(page.getByText('New transfers are running')).toBeVisible();
  // Signing in used this step's code; a person would wait for the next one, the test rewinds.
  await freshStep();
  const answers = ['Back at 14:00', totp(secret)];
  page.on('dialog', (d) => void d.accept(answers.shift()));
  await page.getByRole('button', { name: 'Pause new transfers' }).click();
  await expect(
    page.getByText(/New transfers are paused. Customers see: Back at 14:00/),
  ).toBeVisible();

  // Put it back, so the next run (and the other viewport) starts from "running".
  await freshStep();
  answers.push(totp(secret));
  await page.getByRole('button', { name: 'Resume new transfers' }).click();
  await expect(page.getByText('New transfers are running')).toBeVisible();
});
