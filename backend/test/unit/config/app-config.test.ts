import test from 'node:test';
import assert from 'node:assert/strict';
import { envSchema, parseEnv } from '../../../src/config/env.ts';
import { ConfigError, loadConfig } from '../../../src/config/app-config.ts';

const BASE = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/almapay?sslmode=require',
  JWT_SECRET: 'a'.repeat(40),
};
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('loadConfig maps env into the structured config', () => {
  const config = loadConfig(parseEnv({ ...BASE, PORT: '4000' }), '9.9.9');

  assert.equal(config.port, 4000);
  assert.equal(config.version, '9.9.9');
  assert.equal(config.isProduction, false);
  assert.equal(config.database.url, BASE.DATABASE_URL);
  assert.equal(config.auth.issuer, 'almapay');
  assert.equal(config.rateLimit.globalMax, 300);
});

test('APP_VERSION overrides the package version', () => {
  const config = loadConfig(parseEnv({ ...BASE, APP_VERSION: '1.2.3' }), '9.9.9');
  assert.equal(config.version, '1.2.3');
});

test('production enables HSTS and HTTPS enforcement behind a proxy', () => {
  const config = loadConfig(
    parseEnv({
      ...BASE,
      NODE_ENV: 'production',
      TRUST_PROXY: 'true',
      ENCRYPTION_KEY,
      PUBLIC_API_URL: 'https://api.almapay.example/',
    }),
    '1.0.0',
  );
  assert.equal(config.isProduction, true);
  assert.equal(config.httpSecurity.trustProxy, true);
  assert.equal(config.httpSecurity.hstsEnabled, true);
  assert.equal(config.httpSecurity.requireHttps, true);
  assert.equal(config.publicApiUrl, 'https://api.almapay.example');
});

test('production needs the public https address the provider redirects back to', () => {
  for (const PUBLIC_API_URL of [undefined, 'http://api.almapay.example']) {
    assert.throws(
      () =>
        loadConfig(
          parseEnv({ ...BASE, NODE_ENV: 'production', ENCRYPTION_KEY, PUBLIC_API_URL }),
          '1.0.0',
        ),
      /PUBLIC_API_URL must be set/,
    );
  }
});

test('sender countries default to GB and can be configured; the API address defaults to localhost', () => {
  const defaults = loadConfig(parseEnv({ ...BASE }), '1.0.0');
  assert.deepEqual(defaults.senderCountries, ['GB']);
  assert.match(defaults.publicApiUrl, /^http:\/\/localhost:\d+$/);
  const configured = loadConfig(parseEnv({ ...BASE, SENDER_COUNTRIES: 'GB,IE' }), '1.0.0');
  assert.deepEqual(configured.senderCountries, ['GB', 'IE']);
});

test('development does not enforce HTTPS and leaves HSTS off by default', () => {
  const config = loadConfig(parseEnv({ ...BASE }), '1.0.0');
  assert.equal(config.httpSecurity.requireHttps, false);
  assert.equal(config.httpSecurity.hstsEnabled, false);
});

test('HSTS_ENABLED can be forced on independently of NODE_ENV', () => {
  const config = loadConfig(parseEnv({ ...BASE, HSTS_ENABLED: 'true' }), '1.0.0');
  assert.equal(config.httpSecurity.hstsEnabled, true);
});

test('feature flags default to off', () => {
  const config = loadConfig(parseEnv({ ...BASE }), '1.0.0');
  assert.equal(config.features.balanceFundingEnabled, false);
  assert.equal(config.features.devLogMailLinks, false);
});

test('production refuses the example JWT secret', () => {
  assert.throws(
    () =>
      loadConfig(
        parseEnv({
          ...BASE,
          NODE_ENV: 'production',
          JWT_SECRET: 'dev-only-insecure-secret-change-me-0123456789',
        }),
        '1.0.0',
      ),
    ConfigError,
  );
});

test('production refuses to log mail links', () => {
  assert.throws(
    () =>
      loadConfig(
        parseEnv({ ...BASE, NODE_ENV: 'production', DEV_LOG_MAIL_LINKS: 'true' }),
        '1.0.0',
      ),
    /DEV_LOG_MAIL_LINKS/,
  );
});

test('production refuses to start without an encryption key', () => {
  assert.throws(
    () => loadConfig(parseEnv({ ...BASE, NODE_ENV: 'production' }), '1.0.0'),
    /ENCRYPTION_KEY must be set/,
  );
});

// --- Production safety checks ------------------------------------------------------

const PROD = {
  ...BASE,
  NODE_ENV: 'production',
  ENCRYPTION_KEY,
  PUBLIC_API_URL: 'https://api.almapay.example',
  TRUST_PROXY: 'true',
};

function problems(overrides: Record<string, string | undefined>): string {
  try {
    loadConfig(parseEnv({ ...PROD, ...overrides }), '1.0.0');
    return '';
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.message;
  }
}

test('a correct production configuration loads', () => {
  assert.equal(problems({}), '');
  assert.equal(
    problems({
      PAYOUT_PROVIDER: 'airwallex',
      PROVIDER_REDIRECT_HOSTS: 'id.provider.example',
      AIRWALLEX_CLIENT_ID: 'x',
    }).includes('Unsafe'),
    false,
  );
});

test('production refuses a database connection without TLS', () => {
  assert.match(
    problems({ DATABASE_URL: 'postgres://user:pass@db.internal:5432/almapay' }),
    /DATABASE_URL must require TLS/,
  );
  for (const mode of ['require', 'verify-ca', 'verify-full']) {
    assert.equal(problems({ DATABASE_URL: `postgres://u:p@db/almapay?sslmode=${mode}` }), '');
  }
  assert.match(problems({ DATABASE_URL: 'postgres://u:p@db/almapay?sslmode=disable' }), /TLS/);
});

test('production must sit behind a TLS-terminating proxy, or it cannot refuse plain HTTP', () => {
  assert.match(problems({ TRUST_PROXY: 'false' }), /TRUST_PROXY must be true/);
});

test('production needs the provider host list for a real provider, https-only CORS origins, and no dev secrets', () => {
  assert.match(
    problems({ PAYOUT_PROVIDER: 'wise', PROVIDER_REDIRECT_HOSTS: '' }),
    /PROVIDER_REDIRECT_HOSTS/,
  );
  assert.match(
    problems({ CORS_ALLOWED_ORIGINS: 'http://app.example.com' }),
    /CORS_ALLOWED_ORIGINS must be https/,
  );
  assert.equal(problems({ CORS_ALLOWED_ORIGINS: 'https://app.example.com' }), '');
  assert.match(
    problems({ MOCK_WEBHOOK_SECRET: 'dev-only-secret-0123456789' }),
    /MOCK_WEBHOOK_SECRET/,
  );
});

test('CORS origins and provider hosts must be well-formed; a wildcard is never accepted', () => {
  for (const bad of [
    '*',
    'https://*.example.com',
    'https://app.example.com/path',
    'app.example.com',
  ]) {
    assert.throws(
      () => parseEnv({ ...BASE, CORS_ALLOWED_ORIGINS: bad }),
      /CORS_ALLOWED_ORIGINS/,
      bad,
    );
  }
  assert.throws(
    () => parseEnv({ ...BASE, PROVIDER_REDIRECT_HOSTS: 'https://id.example' }),
    /PROVIDER_REDIRECT_HOSTS/,
  );
  const config = loadConfig(
    parseEnv({
      ...BASE,
      CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://www.example.com',
      PROVIDER_REDIRECT_HOSTS: 'ID.Provider.example',
    }),
    '1.0.0',
  );
  assert.deepEqual(config.corsAllowedOrigins, [
    'https://app.example.com',
    'https://www.example.com',
  ]);
  assert.deepEqual(config.providerRedirectHosts, ['id.provider.example']);
});

test('no secret has a default value: a missing one stops the server from starting', () => {
  // Every setting whose name says it is a secret, key, token or password must
  // either be required or be optional with NO default.
  const secretLike =
    /(SECRET$|PRIVATE_KEY$|^ENCRYPTION_KEY$|API_TOKEN$|CLIENT_KEY$|^SEED_USER_PASSWORD$)/;
  const shape = (
    envSchema as unknown as {
      shape: Record<string, { _zod: { def: { type: string; defaultValue?: unknown } } }>;
    }
  ).shape;
  const checked: string[] = [];
  for (const [name, schema] of Object.entries(shape)) {
    if (!secretLike.test(name)) continue;
    checked.push(name);
    assert.notEqual(schema._zod.def.type, 'default', `${name} must not have a default value`);
  }
  assert.ok(checked.includes('JWT_SECRET') && checked.includes('ENCRYPTION_KEY'));

  assert.throws(() => parseEnv({ DATABASE_URL: BASE.DATABASE_URL }), /JWT_SECRET/);
  assert.throws(() => parseEnv({ JWT_SECRET: BASE.JWT_SECRET }), /DATABASE_URL/);
  assert.throws(() => parseEnv({ ...BASE, JWT_SECRET: 'too-short' }), /JWT_SECRET/);
});

test('transfer limits must grow with the period, and are read from the environment', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/a', JWT_SECRET: 'a'.repeat(40) };
  const defaults = loadConfig(parseEnv(base), '1.0.0').transferLimits;
  assert.deepEqual(defaults, {
    currency: 'GBP',
    perTransfer: '5000',
    perDay: '10000',
    perMonth: '25000',
  });

  const custom = loadConfig(
    parseEnv({
      ...base,
      TRANSFER_LIMIT_PER_TRANSFER: '250',
      TRANSFER_LIMIT_PER_DAY: '500.50',
      TRANSFER_LIMIT_PER_MONTH: '1500',
      TRANSFER_LIMIT_CURRENCY: 'EUR',
    }),
    '1.0.0',
  ).transferLimits;
  assert.deepEqual(custom, {
    currency: 'EUR',
    perTransfer: '250',
    perDay: '500.50',
    perMonth: '1500',
  });

  assert.throws(
    () =>
      loadConfig(
        parseEnv({ ...base, TRANSFER_LIMIT_PER_TRANSFER: '6000', TRANSFER_LIMIT_PER_DAY: '5000' }),
        '1.0.0',
      ),
    /must not exceed/,
  );
  assert.throws(
    () => loadConfig(parseEnv({ ...base, TRANSFER_LIMIT_PER_DAY: '30000' }), '1.0.0'),
    /must not exceed/,
  );
});
