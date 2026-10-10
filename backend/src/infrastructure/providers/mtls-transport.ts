import { X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../shared/logger.ts';
import { ProviderConfigError } from './provider-config-error.ts';
import { fetchTransport, type ProviderTransport } from './provider-http-client.ts';

/** The client certificate SomPay presents to a provider that requires mutual TLS. */
export interface MtlsMaterial {
  readonly cert: Buffer;
  readonly key: Buffer;
  /** The provider's CA certificate, when it is not in the system trust store. */
  readonly ca?: Buffer | undefined;
  readonly passphrase?: string | undefined;
  readonly validTo: Date;
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const WARN_DAYS_BEFORE_EXPIRY = 30;

interface FileReader {
  read(path: string): Buffer;
  /** True if anyone but the owner (and group) can read the file. */
  isWorldReadable(path: string): boolean;
}

const diskReader: FileReader = {
  read: (path) => readFileSync(path),
  isWorldReadable: (path) => (statSync(path).mode & 0o004) !== 0,
};

function readPem(reader: FileReader, name: string, path: string): Buffer {
  let contents: Buffer;
  try {
    contents = reader.read(path);
  } catch {
    // The path is configuration, not a secret; the contents never appear in a message.
    throw new ProviderConfigError(`${name} (${path}) cannot be read.`);
  }
  if (!contents.toString('utf8').includes('-----BEGIN')) {
    throw new ProviderConfigError(`${name} (${path}) is not a PEM file.`);
  }
  return contents;
}

/**
 * Loads the mTLS client certificate and key named by the environment, or
 * returns undefined when none is configured. Fails fast, before any request is
 * made, if a file is missing or unreadable, is not PEM, does not match its
 * partner, has expired, or (in production) the private key is readable by
 * every user on the machine. The key and passphrase are never logged.
 */
export function loadMtlsMaterial(
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'PROVIDER_MTLS_CERT_PATH'
    | 'PROVIDER_MTLS_KEY_PATH'
    | 'PROVIDER_MTLS_CA_PATH'
    | 'PROVIDER_MTLS_KEY_PASSPHRASE'
  >,
  options: { reader?: FileReader; now?: () => Date; logger?: Logger } = {},
): MtlsMaterial | undefined {
  const certPath = env.PROVIDER_MTLS_CERT_PATH;
  const keyPath = env.PROVIDER_MTLS_KEY_PATH;
  if (!certPath && !keyPath) {
    return undefined;
  }
  if (!certPath || !keyPath) {
    throw new ProviderConfigError(
      'PROVIDER_MTLS_CERT_PATH and PROVIDER_MTLS_KEY_PATH must be set together.',
    );
  }
  const reader = options.reader ?? diskReader;
  const now = (options.now ?? (() => new Date()))();

  const cert = readPem(reader, 'PROVIDER_MTLS_CERT_PATH', certPath);
  const key = readPem(reader, 'PROVIDER_MTLS_KEY_PATH', keyPath);
  const ca = env.PROVIDER_MTLS_CA_PATH
    ? readPem(reader, 'PROVIDER_MTLS_CA_PATH', env.PROVIDER_MTLS_CA_PATH)
    : undefined;
  const passphrase = env.PROVIDER_MTLS_KEY_PASSPHRASE;

  if (env.NODE_ENV === 'production' && reader.isWorldReadable(keyPath)) {
    throw new ProviderConfigError(
      'PROVIDER_MTLS_KEY_PATH is readable by every user; restrict it (chmod 600).',
    );
  }

  let validTo: Date;
  try {
    const certificate = new X509Certificate(cert);
    validTo = new Date(certificate.validTo);
    if (
      new Date(certificate.validFrom).getTime() > now.getTime() ||
      validTo.getTime() <= now.getTime()
    ) {
      throw new ProviderConfigError(
        'The mTLS client certificate is not valid today (expired or not yet valid).',
      );
    }
    // Throws if the key does not belong to the certificate or needs a passphrase.
    tls.createSecureContext({ cert, key, ...(passphrase ? { passphrase } : {}) });
  } catch (error) {
    if (error instanceof ProviderConfigError) throw error;
    throw new ProviderConfigError(
      'The mTLS certificate and private key cannot be used together (wrong key, wrong passphrase or damaged file).',
    );
  }

  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft <= WARN_DAYS_BEFORE_EXPIRY) {
    options.logger?.warn('provider.mtls.certificate_expiring', { daysLeft });
  }
  return { cert, key, ca, passphrase, validTo };
}

type HttpsRequest = (
  options: https.RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

/**
 * A provider transport that presents the client certificate on every
 * connection. Server certificates are always verified (never disabled), TLS 1.2
 * is the minimum, and a response is capped in size.
 */
export function createMtlsTransport(
  material: MtlsMaterial,
  request: HttpsRequest = https.request,
): ProviderTransport {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      if (target.protocol !== 'https:') {
        reject(new Error('mTLS requires an https URL'));
        return;
      }
      const req = request(
        {
          protocol: 'https:',
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: init.method,
          headers: init.headers,
          cert: material.cert,
          key: material.key,
          ...(material.ca ? { ca: material.ca } : {}),
          ...(material.passphrase ? { passphrase: material.passphrase } : {}),
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
          signal: init.signal,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(new Error('response too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: response.statusCode ?? 0,
              headers: {
                get: (name: string): string | null => {
                  const value = response.headers[name.toLowerCase()];
                  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
                },
              },
              text: () => Promise.resolve(text),
            });
          });
        },
      );
      req.on('error', reject);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
}

/**
 * The transport a provider adapter should use: an injected one (tests), else
 * mTLS when the environment configures a client certificate, else plain fetch.
 */
export function providerTransport(
  env: Parameters<typeof loadMtlsMaterial>[0],
  logger: Logger,
  injected?: ProviderTransport,
): ProviderTransport {
  if (injected) {
    return injected;
  }
  const material = loadMtlsMaterial(env, { logger });
  if (!material) {
    return fetchTransport;
  }
  logger.info('provider.mtls.enabled', { validTo: material.validTo.toISOString() });
  return createMtlsTransport(material);
}
