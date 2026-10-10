/**
 * One outgoing email. The sender only delivers it; what it says is decided by
 * the templates (`templates.ts`), so switching email provider never changes wording.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Which template made it (for logs and provider tags). Never contains personal data. */
  readonly template: string;
}

/**
 * Delivers email. Implementations: log only (the default), Postmark, Resend,
 * Amazon SES. They must not log the message body or the full address in production,
 * and a failure must be thrown so the caller can retry or give up.
 */
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Thrown by a sender when the provider did not accept the message. Carries no body or address. */
export class EmailDeliveryError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.retryable = retryable;
  }
}
