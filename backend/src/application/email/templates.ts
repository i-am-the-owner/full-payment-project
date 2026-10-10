import {
  composeTransferNotice,
  type TransferMessageFacts,
} from '../notifications/transfer-messages.ts';

/**
 * Every customer email. Plain, short, no tracking, no remote images. Each template
 * returns the subject, a plain-text body and an HTML body built from the same text
 * (everything interpolated into HTML is escaped).
 */

export interface RenderedEmail {
  readonly template: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FOOTER =
  'SomPay does not hold your money. Payments are provided by our licensed payout provider.';

function render(
  template: string,
  subject: string,
  paragraphs: readonly string[],
  action?: { label: string; url: string },
): RenderedEmail {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), FOOTER].join(
    '\n\n',
  );
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replaceAll('\n', '<br>')}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:0 0 14px"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#0b5fff;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>`
    : '';
  const html =
    `<!doctype html><html lang="en"><body style="font:15px/1.5 system-ui,Arial,sans-serif;color:#14181f">` +
    `<div style="max-width:520px;margin:0 auto;padding:16px">${body}${button}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#5b6472">${escapeHtml(FOOTER)}</p></div></body></html>`;
  return { template, subject, text, html };
}

/** A sign-in or sign-up code typed into the app. */
export function emailCodeEmail(input: { code: string; minutesValid: number }): RenderedEmail {
  return render('email_code', `Your SomPay code is ${input.code}`, [
    `Your SomPay code is ${input.code}.`,
    `It works for ${input.minutesValid} minutes. If you did not ask for it, ignore this email and do not share the code with anyone: we will never ask you for it.`,
  ]);
}

/** The link that confirms an email address (the app's current way of verifying). */
export function emailVerificationEmail(input: { url: string }): RenderedEmail {
  return render(
    'email_verification',
    'Confirm your email address',
    ['Please confirm your email address to finish setting up your SomPay account.'],
    { label: 'Confirm email address', url: input.url },
  );
}

export function passwordResetEmail(input: { url: string; minutesValid: number }): RenderedEmail {
  return render(
    'password_reset',
    'Reset your SomPay password',
    [
      'Someone asked to reset the password on your SomPay account.',
      `The link works for ${input.minutesValid} minutes and can be used once. If it was not you, ignore this email: your password has not changed.`,
    ],
    { label: 'Choose a new password', url: input.url },
  );
}

export function passwordChangedEmail(): RenderedEmail {
  return render('password_changed', 'Your SomPay password was changed', [
    'The password on your SomPay account was just changed.',
    'If this was not you, reset your password now and contact support.',
  ]);
}

export function duplicateRegistrationEmail(): RenderedEmail {
  return render('duplicate_registration', 'You already have an SomPay account', [
    'Someone tried to sign up to SomPay with this email address, but you already have an account.',
    'If it was you, just sign in (or reset your password if you forgot it). If not, you can ignore this email.',
  ]);
}

export interface WaitingForPaymentFacts extends TransferMessageFacts {
  /** The payment reference the customer must put on their bank transfer. */
  readonly paymentReference: string;
}

/** The transfer exists and the provider is waiting for the customer's payment. */
export function transferWaitingForPaymentEmail(facts: WaitingForPaymentFacts): RenderedEmail {
  const { youPaid, recipientGets, recipientName: to, providerName: provider } = facts;
  return render(
    'transfer_waiting_for_payment',
    `Pay ${youPaid} to ${provider} to send your transfer`,
    [
      `Your transfer of ${recipientGets} to ${to} is ready, and ${provider} is waiting for your payment of ${youPaid}.`,
      `Pay ${provider} directly from your bank, using the details in the app and this payment reference: ${facts.paymentReference}. SomPay never receives your money.`,
      `Your reference: ${facts.reference}`,
    ],
  );
}

function fromNotice(template: string, facts: TransferMessageFacts): RenderedEmail {
  const notice = composeTransferNotice(facts);
  return render(template, notice.subject, notice.text.trim().split(/\n\n/));
}

export const fundsReceivedEmail = (facts: TransferMessageFacts): RenderedEmail =>
  fromNotice('transfer_funds_received', { ...facts, kind: 'FUNDS_RECEIVED' });
export const deliveredEmail = (facts: TransferMessageFacts): RenderedEmail =>
  fromNotice('transfer_delivered', { ...facts, kind: 'DELIVERED' });
/** Money sent back to the customer (refund), or a transfer that could not be delivered. */
export const returnedEmail = (facts: TransferMessageFacts): RenderedEmail =>
  fromNotice('transfer_returned', { ...facts, kind: 'REFUNDED' });

export type IdCheckResult = 'verified' | 'needs_review' | 'rejected';

/** The outcome of the provider's identity check. We never say more than the provider decided. */
export function idCheckResultEmail(input: {
  result: IdCheckResult;
  providerName: string;
  supportEmail: string;
}): RenderedEmail {
  const { providerName: provider } = input;
  switch (input.result) {
    case 'verified':
      return render('id_check_verified', 'Your identity check is complete', [
        `${provider} has verified your identity. You can now send money with SomPay.`,
      ]);
    case 'needs_review':
      return render('id_check_review', 'We need to look at your identity check', [
        `${provider} completed your identity check, but some details do not match what you gave us, so sending is on hold while we review it.`,
        `We will email you when we have checked. You can also write to ${input.supportEmail}.`,
      ]);
    case 'rejected':
      return render('id_check_rejected', 'Your identity check was not successful', [
        `${provider} could not verify your identity, so you cannot send money yet.`,
        `${provider} decides this, not SomPay. For questions write to ${input.supportEmail}.`,
      ]);
  }
}
