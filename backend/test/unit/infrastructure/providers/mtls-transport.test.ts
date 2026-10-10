import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMtlsTransport,
  loadMtlsMaterial,
} from '../../../../src/infrastructure/providers/mtls-transport.ts';
import { ProviderConfigError } from '../../../../src/infrastructure/providers/provider-config-error.ts';
import { createLogger } from '../../../../src/shared/logger.ts';

/** Throwaway certificates, generated for these tests only. Nothing here is a real credential. */
const dir = mkdtempSync(join(tmpdir(), 'almapay-mtls-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function makeCert(name: string, options: { days?: number; san?: string; cn?: string } = {}) {
  const key = join(dir, `${name}.key`);
  const cert = join(dir, `${name}.pem`);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      String(options.days ?? 30),
      '-subj',
      `/O=Test/CN=${options.cn ?? name}`,
      ...(options.san ? ['-addext', `subjectAltName=${options.san}`] : []),
    ],
    { stdio: 'ignore' },
  );
  chmodSync(key, 0o600);
  return { key, cert };
}

const client = makeCert('almapay-client', { cn: 'almapay-client-id', days: 90 });
const server = makeCert('provider-server', { san: 'DNS:localhost', cn: 'localhost' });
const other = makeCert('someone-else');

const env = (over: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'test' as const,
  PROVIDER_MTLS_CERT_PATH: client.cert,
  PROVIDER_MTLS_KEY_PATH: client.key,
  PROVIDER_MTLS_CA_PATH: undefined as string | undefined,
  PROVIDER_MTLS_KEY_PASSPHRASE: undefined as string | undefined,
  ...over,
});

test('with no mTLS configured nothing is loaded', () => {
  assert.equal(
    loadMtlsMaterial(
      env({ PROVIDER_MTLS_CERT_PATH: undefined, PROVIDER_MTLS_KEY_PATH: undefined }),
    ),
    undefined,
  );
});

test('the certificate and key load from their paths', () => {
  const material = loadMtlsMaterial(env());
  assert.ok(material);
  assert.ok(material.cert.toString().includes('BEGIN CERTIFICATE'));
  assert.ok(material.validTo.getTime() > Date.now());
});

test('start-up fails, naming the setting but never the contents, when the files are wrong', () => {
  const fails = (over: Record<string, string | undefined>, pattern: RegExp) =>
    assert.throws(
      () => loadMtlsMaterial(env(over)),
      (error: unknown) => {
        assert.ok(error instanceof ProviderConfigError);
        assert.match(error.message, pattern);
        assert.ok(!error.message.includes('BEGIN'));
        return true;
      },
    );

  fails({ PROVIDER_MTLS_KEY_PATH: undefined }, /must be set together/);
  fails(
    { PROVIDER_MTLS_CERT_PATH: join(dir, 'missing.pem') },
    /PROVIDER_MTLS_CERT_PATH .* cannot be read/,
  );
  fails({ PROVIDER_MTLS_CA_PATH: join(dir, 'missing-ca.pem') }, /PROVIDER_MTLS_CA_PATH/);
  const notPem = join(dir, 'not-pem.txt');
  writeFileSync(notPem, 'just some text');
  fails({ PROVIDER_MTLS_KEY_PATH: notPem }, /not a PEM file/);
  // A key that belongs to a different certificate.
  fails({ PROVIDER_MTLS_KEY_PATH: other.key }, /cannot be used together/);
});

test('an expired or not-yet-valid certificate is refused, and one about to expire is reported', () => {
  const later = () => new Date(Date.now() + 120 * 86_400_000);
  assert.throws(() => loadMtlsMaterial(env(), { now: later }), /not valid today/);
  const earlier = () => new Date(Date.now() - 10 * 86_400_000);
  assert.throws(() => loadMtlsMaterial(env(), { now: earlier }), /not valid today/);

  const lines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (_l, line) => lines.push(line) });
  const nearExpiry = () => new Date(Date.now() + 70 * 86_400_000);
  assert.ok(loadMtlsMaterial(env(), { now: nearExpiry, logger }));
  assert.ok(lines.some((line) => line.includes('provider.mtls.certificate_expiring')));
  assert.ok(lines.every((line) => !line.includes('PRIVATE KEY')));
});

test('in production a private key that every user can read is refused', () => {
  const loose = makeCert('loose-key', { days: 90 });
  chmodSync(loose.key, 0o644);
  const prod = env({ PROVIDER_MTLS_CERT_PATH: loose.cert, PROVIDER_MTLS_KEY_PATH: loose.key });
  assert.ok(loadMtlsMaterial(prod));
  assert.throws(
    () => loadMtlsMaterial({ ...prod, NODE_ENV: 'production' }),
    /readable by every user/,
  );
  chmodSync(loose.key, 0o600);
  assert.ok(loadMtlsMaterial({ ...prod, NODE_ENV: 'production' }));
});

test('the transport presents the client certificate, and a server that demands one rejects a client without it', async () => {
  const seen: string[] = [];
  const secured = https.createServer(
    {
      cert: readFileSync(server.cert),
      key: readFileSync(server.key),
      requestCert: true,
      rejectUnauthorized: true,
      // The provider trusts the client certificate we generated.
      ca: readFileSync(client.cert),
    },
    (req, res) => {
      const peer = (req.socket as TLSSocket).getPeerCertificate();
      seen.push(String((peer.subject as { CN?: string }).CN));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ hello: 'client', method: req.method, auth: req.headers.authorization }),
      );
    },
  );
  await new Promise<void>((resolve) => secured.listen(0, '127.0.0.1', resolve));
  const port = (secured.address() as AddressInfo).port;
  try {
    const material = loadMtlsMaterial(env({ PROVIDER_MTLS_CA_PATH: server.cert }))!;
    const transport = createMtlsTransport(material);
    const response = await transport(`https://localhost:${port}/v1/ping?x=1`, {
      method: 'POST',
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      body: '{"a":1}',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(await response.text()), {
      hello: 'client',
      method: 'POST',
      auth: 'Bearer abc',
    });
    assert.deepEqual(seen, ['almapay-client-id']);

    // The same server, but this client presents a certificate the provider does not trust.
    const wrong = createMtlsTransport(
      loadMtlsMaterial(
        env({
          PROVIDER_MTLS_CERT_PATH: other.cert,
          PROVIDER_MTLS_KEY_PATH: other.key,
          PROVIDER_MTLS_CA_PATH: server.cert,
        }),
      )!,
    );
    await assert.rejects(
      wrong(`https://localhost:${port}/v1/ping`, {
        method: 'GET',
        headers: {},
        signal: AbortSignal.timeout(5000),
      }),
    );

    // The provider's own certificate is always verified: an unknown server is refused.
    const noCa = createMtlsTransport(loadMtlsMaterial(env())!);
    await assert.rejects(
      noCa(`https://localhost:${port}/v1/ping`, {
        method: 'GET',
        headers: {},
        signal: AbortSignal.timeout(5000),
      }),
      /self.signed|unable to verify|certificate/i,
    );
    await assert.rejects(
      createMtlsTransport(material)('http://localhost/insecure', {
        method: 'GET',
        headers: {},
        signal: AbortSignal.timeout(1000),
      }),
      /https/,
    );
  } finally {
    await new Promise((resolve) => secured.close(resolve));
  }
});
