import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailSender,
} from '../../../../src/application/email/email-sender.ts';
import { TemplatedMailer } from '../../../../src/infrastructure/mail/templated-mailer.ts';
import { createLogger } from '../../../../src/shared/logger.ts';

function arrange(fail = false) {
  const sent: EmailMessage[] = [];
  const lines: string[] = [];
  const sender: EmailSender = {
    name: 'fake',
    send(m) {
      if (fail)
        return Promise.reject(new EmailDeliveryError('fake: the email service answered 503', true));
      sent.push(m);
      return Promise.resolve();
    },
  };
  const mailer = new TemplatedMailer({
    sender,
    logger: createLogger({ level: 'debug', write: (_l, line) => lines.push(line) }),
    supportEmail: 'support@almapay.example',
    providerName: () => 'Wise',
    resetMinutes: 60,
  });
  return { mailer, sent, lines };
}

test('every kind of email goes through the sender with the right template', async () => {
  const { mailer, sent } = arrange();
  await mailer.sendEmailVerification('a@b.example', 'https://x.example/v?token=1');
  await mailer.sendPasswordReset('a@b.example', 'https://x.example/r?token=1');
  await mailer.sendPasswordChangedNotice('a@b.example');
  await mailer.sendDuplicateRegistrationNotice('a@b.example');
  await mailer.sendEmailCode('a@b.example', '123456');
  await mailer.sendIdCheckResult('a@b.example', 'verified');
  await mailer.sendTransferNotice('a@b.example', {
    kind: 'DELIVERED',
    subject: 'Done',
    text: 'Para one.\n\nPara two.\n',
    reference: 'ALM-1',
  });
  assert.deepEqual(
    sent.map((m) => m.template),
    [
      'email_verification',
      'password_reset',
      'password_changed',
      'duplicate_registration',
      'email_code',
      'id_check_verified',
      'transfer_delivered',
    ],
  );
  assert.match(sent[1]!.text, /60 minutes/);
  assert.match(sent[5]!.text, /Wise has verified/);
});

test('account emails never fail the caller and never log the address or reason in full', async () => {
  const { mailer, lines } = arrange(true);
  await mailer.sendPasswordReset('jane@example.com', 'https://x.example/r?token=SECRET');
  const out = lines.join('\n');
  assert.match(out, /mail\.failed/);
  assert.ok(!out.includes('jane@example.com') && !out.includes('SECRET'));
});

test('transfer notices throw, so the job queue retries them', async () => {
  const { mailer } = arrange(true);
  await assert.rejects(
    mailer.sendTransferNotice('a@b.example', {
      kind: 'SENT',
      subject: 's',
      text: 't',
      reference: 'r',
    }),
    EmailDeliveryError,
  );
  await assert.rejects(
    mailer.sendTransferWaitingForPayment('a@b.example', {
      kind: 'FUNDS_RECEIVED',
      youPaid: '1 GBP',
      recipientGets: '1 EUR',
      recipientName: 'A',
      providerName: 'Wise',
      reference: 'r',
      supportEmail: 's@a.example',
      paymentReference: 'T1',
    }),
    EmailDeliveryError,
  );
});
