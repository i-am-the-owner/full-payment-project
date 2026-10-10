import type { EmailMessage, EmailSender } from '../../application/email/email-sender.ts';
import { signV4 } from './aws-sigv4.ts';
import { postJson } from './http-email-sender.ts';

/**
 * Amazon SES v2 `SendEmail` (https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html),
 * signed with SigV4. NOT yet tested against live SES. In production prefer an IAM role or
 * short-lived credentials, with only `ses:SendEmail` allowed.
 */
export class SesEmailSender implements EmailSender {
  readonly name = 'ses';
  readonly #options: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | undefined;
    from: string;
    fetchImpl: typeof fetch;
    now: () => Date;
  };

  constructor(options: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | undefined;
    from: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) {
    this.#options = {
      ...options,
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? (() => new Date()),
    };
  }

  send(message: EmailMessage): Promise<void> {
    const o = this.#options;
    const host = `email.${o.region}.amazonaws.com`;
    const body = JSON.stringify({
      FromEmailAddress: o.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: message.html, Charset: 'UTF-8' },
          },
        },
      },
      EmailTags: [{ Name: 'template', Value: message.template }],
    });
    const signed = signV4({
      method: 'POST',
      host,
      path: '/v2/email/outbound-emails',
      body,
      region: o.region,
      service: 'ses',
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      sessionToken: o.sessionToken,
      headers: { 'content-type': 'application/json' },
      now: o.now(),
    });
    const { host: _host, ...sendHeaders } = signed.headers;
    return postJson({
      provider: 'ses',
      url: `https://${host}/v2/email/outbound-emails`,
      headers: { ...sendHeaders, authorization: signed.authorization },
      body,
      fetchImpl: o.fetchImpl,
      timeoutMs: 10_000,
    });
  }
}
