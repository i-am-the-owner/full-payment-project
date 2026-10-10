import type { EmailMessage, EmailSender } from '../../application/email/email-sender.ts';
import { postJson } from './http-email-sender.ts';

/** Postmark's Email API (https://postmarkapp.com/developer/api/email-api). NOT yet tested against live Postmark. */
export class PostmarkEmailSender implements EmailSender {
  readonly name = 'postmark';
  readonly #token: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(options: {
    serverToken: string;
    from: string;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
  }) {
    this.#token = options.serverToken;
    this.#from = options.from;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#baseUrl = options.baseUrl ?? 'https://api.postmarkapp.com';
  }

  send(message: EmailMessage): Promise<void> {
    return postJson({
      provider: 'postmark',
      url: `${this.#baseUrl}/email`,
      headers: { 'X-Postmark-Server-Token': this.#token },
      body: JSON.stringify({
        From: this.#from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        MessageStream: 'outbound',
        Tag: message.template,
        TrackOpens: false,
        TrackLinks: 'None',
      }),
      fetchImpl: this.#fetch,
      timeoutMs: 10_000,
    });
  }
}
