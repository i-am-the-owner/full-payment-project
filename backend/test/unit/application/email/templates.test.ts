import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveredEmail,
  duplicateRegistrationEmail,
  emailCodeEmail,
  emailVerificationEmail,
  escapeHtml,
  fundsReceivedEmail,
  idCheckResultEmail,
  passwordChangedEmail,
  passwordResetEmail,
  returnedEmail,
  transferWaitingForPaymentEmail,
} from '../../../../src/application/email/templates.ts';

const facts = {
  kind: 'DELIVERED' as const,
  youPaid: '100.00 GBP',
  recipientGets: '117.00 EUR',
  recipientName: 'Anna <b>Schmidt</b>',
  providerName: 'Wise',
  reference: 'ALM-ABC123',
  supportEmail: 'support@almapay.example',
};

test('every template has a subject, text and html, and says SomPay does not hold the money', () => {
  const all = [
    emailCodeEmail({ code: '123456', minutesValid: 10 }),
    emailVerificationEmail({ url: 'https://app.example/verify?token=t' }),
    passwordResetEmail({ url: 'https://app.example/reset?token=t', minutesValid: 60 }),
    passwordChangedEmail(),
    duplicateRegistrationEmail(),
    transferWaitingForPaymentEmail({ ...facts, paymentReference: 'T123' }),
    fundsReceivedEmail(facts),
    deliveredEmail(facts),
    returnedEmail(facts),
    idCheckResultEmail({ result: 'verified', providerName: 'Wise', supportEmail: 's@a.example' }),
    idCheckResultEmail({
      result: 'needs_review',
      providerName: 'Wise',
      supportEmail: 's@a.example',
    }),
    idCheckResultEmail({ result: 'rejected', providerName: 'Wise', supportEmail: 's@a.example' }),
  ];
  assert.equal(new Set(all.map((e) => e.template)).size, all.length, 'distinct template names');
  for (const e of all) {
    assert.ok(e.subject.length > 3 && e.subject.length < 90, e.template);
    assert.ok(e.text.length > 20 && e.html.startsWith('<!doctype html>'), e.template);
    assert.match(e.text, /does not hold your money/, e.template);
    assert.ok(!/<img|src=|https?:\/\/[^ ]*track/i.test(e.html), `${e.template}: no remote content`);
  }
});

test('the code, the links and the amounts appear where they should', () => {
  const code = emailCodeEmail({ code: '482913', minutesValid: 10 });
  assert.match(code.subject, /482913/);
  assert.match(code.text, /10 minutes/);
  assert.match(code.text, /never ask you for it/);

  const reset = passwordResetEmail({
    url: 'https://app.example/reset?token=abc',
    minutesValid: 60,
  });
  assert.match(reset.text, /https:\/\/app\.example\/reset\?token=abc/);
  assert.match(reset.html, /href="https:\/\/app\.example\/reset\?token=abc"/);

  const waiting = transferWaitingForPaymentEmail({ ...facts, paymentReference: 'T80106743' });
  assert.match(waiting.text, /T80106743/);
  assert.match(waiting.text, /100\.00 GBP/);
  assert.match(waiting.text, /SomPay never receives your money/);

  assert.match(returnedEmail(facts).subject, /sent back to you/);
  assert.match(deliveredEmail(facts).text, /117\.00 EUR/);
});

test('anything interpolated into the html is escaped', () => {
  const html = deliveredEmail(facts).html;
  assert.ok(!html.includes('<b>Schmidt</b>'));
  assert.ok(html.includes('Anna &lt;b&gt;Schmidt&lt;/b&gt;'));
  const evil = passwordResetEmail({
    url: 'https://x.example/"onmouseover="alert(1)',
    minutesValid: 5,
  });
  assert.ok(!evil.html.includes('"onmouseover'));
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('the id check wording never overstates what SomPay decided', () => {
  const rejected = idCheckResultEmail({
    result: 'rejected',
    providerName: 'Wise',
    supportEmail: 's@a.example',
  });
  assert.match(rejected.text, /Wise decides this, not SomPay/);
  const review = idCheckResultEmail({
    result: 'needs_review',
    providerName: 'Wise',
    supportEmail: 's@a.example',
  });
  assert.match(review.text, /on hold/);
  assert.ok(!/verified your identity/.test(review.text));
});
