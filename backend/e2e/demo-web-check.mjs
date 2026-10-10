/**
 * Loads the DEMO web build in headless Chromium at 390px wide, walks Home, Send and
 * Track, takes screenshots, and fails if the page ever asks for anything outside its
 * own origin (the demo must never reach a server) or logs an error.
 *
 *   node e2e/demo-web-check.mjs ../mobile/build/web ../docs/demo/screenshots
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(process.argv[2] ?? '../mobile/build/web');
const out = resolve(process.argv[3] ?? '../docs/demo/screenshots');
mkdirSync(out, { recursive: true });

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.css': 'text/css',
};
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const problems = [];
const outside = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
page.on('request', (r) => {
  if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
    outside.push(r.url());
});

// Flutter web draws to a canvas; its accessibility tree is switched on by one hidden button.
async function enableSemantics() {
  const btn = page.locator('flt-semantics-placeholder');
  if (await btn.count()) await btn.evaluate((el) => el.click());
}
const tap = async (name) => {
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(700);
};
const shot = (name) => page.screenshot({ path: join(out, name) });

await page.goto(origin);
await page.waitForSelector('flutter-view, flt-glass-pane', { timeout: 60000 });
await page.waitForTimeout(2500);
await enableSemantics();
await page.waitForTimeout(800);
await shot('00-welcome.png');

await tap('Create account');
await tap('Continue');
await page.getByRole('textbox').first().fill('123456');
await page.waitForTimeout(300);
await tap('Continue');
await page.waitForTimeout(1200);
await shot('01-home.png');

// Send: open the featured card on Home.
await page.getByText('£1 buys').click();
await page.waitForTimeout(1200);
await shot('02-send.png');

await tap('Continue');
await shot('03-check-ticket.png');
await tap('Confirm transfer');
await shot('04-pay.png');
await tap("I've paid");
await page.waitForTimeout(1500);
await shot('05-track-1.png');
await page.waitForTimeout(8500);
await shot('06-track-delivered.png');

const width = await page.evaluate(() => document.documentElement.scrollWidth);
await browser.close();
server.close();

if (outside.length)
  throw new Error(`The demo requested outside its own origin: ${outside.join(', ')}`);
if (problems.length) throw new Error(`Console errors: ${problems.join(' | ')}`);
if (width > 390) throw new Error(`Horizontal overflow: ${width}px`);
console.log(`OK: no outside requests, no errors, ${width}px wide. Screenshots in ${out}`);
