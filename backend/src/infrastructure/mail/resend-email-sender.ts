import type { EmailMessage, EmailSender } from '../../application/email/email-sender.ts';
import { postJson } from './http-email-sender.ts';

/** Resend's Emails API (https://resend.com/docs/api-reference/emails/send-email). NOT yet tested against live Resend. */
export class ResendEmailSender implements EmailSender {
  readonly name = 'resend';
  readonly #key: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(options: {
    apiKey: string;
    from: string;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
  }) {
    this.#key = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#baseUrl = options.baseUrl ?? 'https://api.resend.com';
  }

  send(message: EmailMessage): Promise<void> {
    return postJson({
      provider: 'resend',
      url: `${this.#baseUrl}/emails`,
      headers: { authorization: `Bearer ${this.#key}` },
      body: JSON.stringify({
        from: this.#from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags: [{ name: 'template', value: message.template }],
      }),
      fetchImpl: this.#fetch,
      timeoutMs: 10_000,
    });
  }
}
