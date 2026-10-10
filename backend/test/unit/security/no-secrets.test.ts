import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanPath, scanText } from '../../../scripts/scan-secrets.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

test('the scanner recognises each kind of secret (and ignores placeholders)', () => {
  const bad = [
    '-----BEGIN PRIVATE KEY-----',
    'const key = "AKIAIOSFODNN7EXAMPLQ"; // aws',
    'stripe: "sk_live_4eC39HqLyjWDarjtT1zdp7dc"',
    'token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
    'jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"',
    'const clientSecret = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";',
    'DATABASE_URL=postgres://almapay:Sup3rS3cretPw@db.prod.internal:5432/almapay',
  ];
  for (const text of bad) {
    assert.ok(scanText(text, 'x.ts').length > 0, text);
  }
  const fine = [
    'JWT_SECRET=dev-only-insecure-secret-change-me-0123456789',
    'DATABASE_URL=postgres://user:pass@localhost:5432/almapay',
    'const password = process.env.PASSWORD;',
    '-----BEGIN PUBLIC KEY-----',
    'const secret = "short";',
    'postgres://almapay:${DB_PASSWORD}@db.internal/almapay',
  ];
  for (const text of fine) {
    assert.deepEqual(scanText(text, 'x.ts'), [], text);
  }
  // The report names the place, never the value.
  const [finding] = scanText('x\nconst clientSecret = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";', 'a.ts');
  assert.deepEqual(Object.keys(finding!).sort(), ['file', 'line', 'rule']);
  assert.equal(finding?.line, 2);
});

test('no secret is in the backend, scripts, mobile or website source, or the example configuration', () => {
  const targets = [
    'backend/src',
    'backend/scripts',
    'backend/migrations',
    'backend/.env.example',
    'mobile/lib',
    'web/src',
    'web/public',
  ]
    .map((path) => `${root}${path}`)
    .filter(existsSync);
  assert.ok(targets.length >= 4);
  assert.deepEqual(
    targets.flatMap((target) => scanPath(target)),
    [],
  );
});

test('no secret is in a built bundle, when one has been built', () => {
  const built = ['backend/dist', 'web/.next/static', 'web/.next/server', 'web/public']
    .map((p) => `${root}${p}`)
    .filter(existsSync);
  assert.deepEqual(
    built.flatMap((target) => scanPath(target)),
    [],
  );
});
