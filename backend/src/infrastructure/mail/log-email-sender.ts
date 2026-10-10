import type { EmailMessage, EmailSender } from '../../application/email/email-sender.ts';
import type { Logger } from '../../shared/logger.ts';
import { maskEmail } from './mask-email.ts';

/**
 * The default sender: delivers nothing, only logs that an email would have been
 * sent. The address is masked and the text (which can hold a single-use link or
 * amounts) is logged only when `includeBodies` is on, which production refuses.
 */
export class LogEmailSender implements EmailSender {
  readonly name = 'log';
  readonly #logger: Logger;
  readonly #includeBodies: boolean;

  constructor(logger: Logger, options: { includeBodies: boolean }) {
    this.#logger = logger;
    this.#includeBodies = options.includeBodies;
  }

  send(message: EmailMessage): Promise<void> {
    this.#logger.info('mail.send', {
      template: message.template,
      to: maskEmail(message.to),
      ...(this.#includeBodies ? { subject: message.subject, text: message.text } : {}),
    });
    return Promise.resolve();
  }
}
