import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../../src/config/env.ts';
import {
  EmailDeliveryError,
  type EmailMessage,
} from '../../../../src/application/email/email-sender.ts';
import { signV4 } from '../../../../src/infrastructure/mail/aws-sigv4.ts';
import { createEmailSender } from '../../../../src/infrastructure/mail/create-email-sender.ts';
import { LogEmailSender } from '../../../../src/infrastructure/mail/log-email-sender.ts';
import { maskEmail } from '../../../../src/infrastructure/mail/mask-email.ts';
import { PostmarkEmailSender } from '../../../../src/infrastructure/mail/postmark-email-sender.ts';
import { ResendEmailSender } from '../../../../src/infrastructure/mail/resend-email-sender.ts';
import { SesEmailSender } from '../../../../src/infrastructure/mail/ses-email-sender.ts';
import { ProviderConfigError } from '../../../../src/infrastructure/providers/provider-config-error.ts';
import { createLogger } from '../../../../src/shared/logger.ts';

// No test here touches the network: every sender gets a fake fetch.

const MESSAGE: EmailMessage = {
  to: 'jane.doe@example.com',
  subject: 'Hello',
  text: 'Text body with SINGLE-USE-SECRET',
  html: '<p>Html</p>',
  template: 'password_reset',
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
function fakeFetch(status = 200): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    return Promise.resolve(new Response('{}', { status }));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test('Postmark: documented endpoint, token header and fields; tracking off', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await new PostmarkEmailSender({
    serverToken: 'pm-token',
    from: 'SomPay <no-reply@almapay.example>',
    fetchImpl,
  }).send(MESSAGE);
  const c = calls[0]!;
  assert.equal(c.url, 'https://api.postmarkapp.com/email');
  assert.equal(c.headers['X-Postmark-Server-Token'], 'pm-token');
  assert.equal(c.body.From, 'SomPay <no-reply@almapay.example>');
  assert.equal(c.body.To, MESSAGE.to);
  assert.equal(c.body.TextBody, MESSAGE.text);
  assert.equal(c.body.HtmlBody, MESSAGE.html);
  assert.equal(c.body.TrackOpens, false);
  assert.equal(c.body.TrackLinks, 'None');
});

test('Resend: documented endpoint, bearer key and fields', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await new ResendEmailSender({
    apiKey: 're_key',
    from: 'no-reply@almapay.example',
    fetchImpl,
  }).send(MESSAGE);
  const c = calls[0]!;
  assert.equal(c.url, 'https://api.resend.com/emails');
  assert.equal(c.headers.authorization, 'Bearer re_key');
  assert.deepEqual(c.body.to, [MESSAGE.to]);
  assert.equal(c.body.subject, 'Hello');
});

test('SES: v2 SendEmail on the regional host, signed with SigV4', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await new SesEmailSender({
    region: 'eu-west-2',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    sessionToken: 'session',
    from: 'no-reply@almapay.example',
    fetchImpl,
    now: () => new Date('2026-10-04T10:00:00Z'),
  }).send(MESSAGE);
  const c = calls[0]!;
  assert.equal(c.url, 'https://email.eu-west-2.amazonaws.com/v2/email/outbound-emails');
  assert.match(
    c.headers.authorization!,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261004\/eu-west-2\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(c.headers['x-amz-date'], '20261004T100000Z');
  assert.equal(c.headers['x-amz-security-token'], 'session');
  assert.equal(c.body.FromEmailAddress, 'no-reply@almapay.example');
  assert.deepEqual(c.body.Destination, { ToAddresses: [MESSAGE.to] });
  assert.equal(
    (c.body.Content as { Simple: { Subject: { Data: string } } }).Simple.Subject.Data,
    'Hello',
  );
});

test('SigV4 matches AWS’s published test vector (get-vanilla)', () => {
  const signed = signV4({
    method: 'GET',
    host: 'example.amazonaws.com',
    path: '/',
    body: '',
    region: 'us-east-1',
    service: 'service',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    now: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(
    signed.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

test('failures are typed, retryable only when retrying can help, and never carry the address or body', async () => {
  for (const [status, retryable] of [
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [422, false],
  ] as const) {
    const { fetchImpl } = fakeFetch(status);
    await assert.rejects(
      new ResendEmailSender({ apiKey: 'k', from: 'f@a.example', fetchImpl }).send(MESSAGE),
      (e: unknown) =>
        e instanceof EmailDeliveryError &&
        e.retryable === retryable &&
        !e.message.includes('jane.doe') &&
        !e.message.includes('SINGLE-USE-SECRET'),
      String(status),
    );
  }
  const down = (() =>
    Promise.reject(new Error('ECONNRESET to jane.doe@example.com'))) as typeof fetch;
  await assert.rejects(
    new PostmarkEmailSender({ serverToken: 't', from: 'f@a.example', fetchImpl: down }).send(
      MESSAGE,
    ),
    (e: unknown) =>
      e instanceof EmailDeliveryError && e.retryable && !e.message.includes('jane.doe'),
  );
});

test('the log sender delivers nothing; the address is masked and the body logged only in development', async () => {
  const lines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (_l, line) => lines.push(line) });
  await new LogEmailSender(logger, { includeBodies: false }).send(MESSAGE);
  let out = lines.join('\n');
  assert.ok(out.includes('j***@example.com') && out.includes('password_reset'));
  assert.ok(!out.includes('jane.doe') && !out.includes('SINGLE-USE-SECRET'));
  lines.length = 0;
  await new LogEmailSender(logger, { includeBodies: true }).send(MESSAGE);
  out = lines.join('\n');
  assert.ok(out.includes('SINGLE-USE-SECRET') && !out.includes('jane.doe'));
  assert.equal(maskEmail('not-an-email'), '***');
});

const BASE = { DATABASE_URL: 'postgres://u:p@localhost:5432/a', JWT_SECRET: 'a'.repeat(40) };
const build = (extra: Record<string, string>) =>
  createEmailSender({
    env: parseEnv({ ...BASE, ...extra }),
    logger: createLogger({ level: 'error', write: () => {} }),
    includeBodies: false,
  });

test('EMAIL_PROVIDER picks the sender and names any variable that is missing', () => {
  assert.equal(build({}).name, 'log');
  assert.equal(
    build({ EMAIL_PROVIDER: 'postmark', EMAIL_FROM: 'a@b.example', POSTMARK_SERVER_TOKEN: 't' })
      .name,
    'postmark',
  );
  assert.equal(
    build({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.example', RESEND_API_KEY: 'k' }).name,
    'resend',
  );
  assert.equal(
    build({
      EMAIL_PROVIDER: 'ses',
      EMAIL_FROM: 'a@b.example',
      AWS_SES_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'i',
      AWS_SECRET_ACCESS_KEY: 's',
    }).name,
    'ses',
  );
  assert.throws(() => build({ EMAIL_PROVIDER: 'postmark' }), /EMAIL_FROM, POSTMARK_SERVER_TOKEN/);
  assert.throws(
    () => build({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.example' }),
    ProviderConfigError,
  );
  assert.throws(
    () => build({ EMAIL_PROVIDER: 'ses', EMAIL_FROM: 'a@b.example' }),
    /AWS_SES_REGION/,
  );
  assert.throws(() => parseEnv({ ...BASE, EMAIL_PROVIDER: 'sendgrid' }), /EMAIL_PROVIDER/);
});
