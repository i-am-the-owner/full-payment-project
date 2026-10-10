import type { AccountMailer, Mailer } from '../../application/auth/mailer.ts';
import type { EmailSender } from '../../application/email/email-sender.ts';
import {
  duplicateRegistrationEmail,
  emailCodeEmail,
  emailVerificationEmail,
  idCheckResultEmail,
  passwordChangedEmail,
  passwordResetEmail,
  transferWaitingForPaymentEmail,
  type IdCheckResult,
  type RenderedEmail,
  type WaitingForPaymentFacts,
} from '../../application/email/templates.ts';
import type { TransferMailer } from '../../application/notifications/ports.ts';
import type { TransferNotice } from '../../application/notifications/transfer-messages.ts';
import type { Logger } from '../../shared/logger.ts';

export interface TemplatedMailerOptions {
  readonly sender: EmailSender;
  readonly logger: Logger;
  readonly supportEmail: string;
  readonly providerName: () => string;
  /** Minutes the reset link and the email code stay valid (as configured). */
  readonly resetMinutes: number;
  readonly codeMinutes?: number;
}

/**
 * Every email the app sends, through one {@link EmailSender}. Account emails
 * (verify, reset, codes) are best effort: a failure is logged and swallowed, so a
 * mail outage never makes registration or reset fail (and never reveals whether an
 * address is registered). Transfer notices THROW, so the job queue retries them.
 */
export class TemplatedMailer implements Mailer, TransferMailer, AccountMailer {
  readonly #o: TemplatedMailerOptions;

  constructor(options: TemplatedMailerOptions) {
    this.#o = options;
  }

  sendEmailVerification(to: string, verificationUrl: string): Promise<void> {
    return this.#bestEffort(to, emailVerificationEmail({ url: verificationUrl }));
  }
  sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    return this.#bestEffort(
      to,
      passwordResetEmail({ url: resetUrl, minutesValid: this.#o.resetMinutes }),
    );
  }
  sendPasswordChangedNotice(to: string): Promise<void> {
    return this.#bestEffort(to, passwordChangedEmail());
  }
  sendDuplicateRegistrationNotice(to: string): Promise<void> {
    return this.#bestEffort(to, duplicateRegistrationEmail());
  }
  sendEmailCode(to: string, code: string): Promise<void> {
    return this.#bestEffort(to, emailCodeEmail({ code, minutesValid: this.#o.codeMinutes ?? 10 }));
  }
  sendIdCheckResult(to: string, result: IdCheckResult): Promise<void> {
    return this.#bestEffort(
      to,
      idCheckResultEmail({
        result,
        providerName: this.#o.providerName(),
        supportEmail: this.#o.supportEmail,
      }),
    );
  }

  sendTransferWaitingForPayment(to: string, facts: WaitingForPaymentFacts): Promise<void> {
    return this.#send(to, transferWaitingForPaymentEmail(facts));
  }

  /** The notice text is already composed (and tested) by the notification worker. */
  sendTransferNotice(to: string, notice: TransferNotice): Promise<void> {
    const template = `transfer_${notice.kind.toLowerCase()}`;
    const paragraphs = notice.text.trim().split(/\n\n/);
    return this.#send(to, {
      template,
      subject: notice.subject,
      text: notice.text,
      html: this.#htmlOf(paragraphs),
    });
  }

  #htmlOf(paragraphs: readonly string[]): string {
    const esc = (v: string): string =>
      v
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    return (
      `<!doctype html><html lang="en"><body style="font:15px/1.5 system-ui,Arial,sans-serif;color:#14181f">` +
      `<div style="max-width:520px;margin:0 auto;padding:16px">` +
      paragraphs
        .map((p) => `<p style="margin:0 0 14px">${esc(p).replaceAll('\n', '<br>')}</p>`)
        .join('') +
      `</div></body></html>`
    );
  }

  #send(to: string, email: RenderedEmail): Promise<void> {
    return this.#o.sender.send({ to, ...email });
  }

  async #bestEffort(to: string, email: RenderedEmail): Promise<void> {
    try {
      await this.#send(to, email);
    } catch (error) {
      this.#o.logger.error('mail.failed', {
        template: email.template,
        sender: this.#o.sender.name,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}
