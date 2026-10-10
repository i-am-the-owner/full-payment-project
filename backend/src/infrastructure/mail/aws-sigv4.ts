import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (data: string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

export interface SigV4Input {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly query?: string;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string | undefined;
  /** Extra headers to sign (lower-case names). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly now: Date;
}

/**
 * AWS Signature Version 4 for one request (Authorization header + the headers that
 * were signed). Written from AWS's published algorithm so no SDK is needed.
 * Checked against AWS's own test vector in the unit tests.
 */
export function signV4(input: SigV4Input): {
  authorization: string;
  headers: Record<string, string>;
} {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20150830T123600Z
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.host,
    'x-amz-date': amzDate,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers,
  };
}
