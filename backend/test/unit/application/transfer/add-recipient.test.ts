import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetRecipientForm } from '../../../../src/application/transfer/add-recipient.ts';
import {
  CustomerNotVerifiedError,
  ValidationFailedError,
} from '../../../../src/domain/payout/errors.ts';
import { ForbiddenError, ValidationError } from '../../../../src/shared/errors.ts';
import { quoteAndRecipient, useCases } from '../../../support/send-money-steps.ts';
import { buildWorld, EUR_RECIPIENT_VALUES, USER } from '../../../support/transfer-fakes.ts';

test('the recipient form comes from the provider', async () => {
  const world = buildWorld();
  const form = await createGetRecipientForm(world)({
    userId: USER,
    currency: 'INR',
    country: 'IN',
  });
  assert.ok(form.fields.some((f) => f.key === 'ifsc'));
  assert.deepEqual(world.calls, ['getRecipientForm']);
});

test('a form can be requested for a quote, which must be the caller’s and match the currency', async () => {
  const world = buildWorld();
  const { quote } = await quoteAndRecipient(world);
  const getForm = createGetRecipientForm(world);

  const form = await getForm({ userId: USER, currency: 'EUR', country: 'DE', quoteId: quote.id });
  assert.ok(form.fields.some((f) => f.key === 'iban'));

  await assert.rejects(
    getForm({ userId: USER, currency: 'USD', country: 'US', quoteId: quote.id }),
    ValidationError,
  );
  world.customerLinkStore.seed('someone-else');
  await assert.rejects(
    getForm({ userId: 'someone-else', currency: 'EUR', country: 'DE', quoteId: quote.id }),
    ForbiddenError,
  );
});

test('only a summary of the recipient is stored and audited – never the bank details', async () => {
  const world = buildWorld();
  const recipient = await useCases(world).addRecipient({
    userId: USER,
    currency: 'EUR',
    country: 'DE',
    values: EUR_RECIPIENT_VALUES,
    displayName: 'Anna (rent)',
  });

  assert.equal(recipient.displayName, 'Anna (rent)');
  assert.equal(recipient.accountHolderName, 'Anna Schmidt');
  assert.equal(recipient.accountSummary, 'IBAN ••••3000');
  assert.equal(recipient.provider, 'mock');
  assert.ok(recipient.providerRecipientId);

  const everythingWeKept = JSON.stringify([
    [...world.recipientRepository.recipients.values()],
    world.auditLog.entries,
  ]);
  assert.equal(everythingWeKept.includes(EUR_RECIPIENT_VALUES.iban), false);
});

test('provider validation errors reach the caller as field errors and nothing is stored', async () => {
  const world = buildWorld();
  await assert.rejects(
    useCases(world).addRecipient({
      userId: USER,
      currency: 'EUR',
      country: 'DE',
      values: { ...EUR_RECIPIENT_VALUES, iban: 'not-an-iban' },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationFailedError);
      assert.deepEqual(
        error.fieldErrors.map((e) => e.field),
        ['iban'],
      );
      return true;
    },
  );
  assert.equal(world.recipientRepository.recipients.size, 0);
});

test('an unverified customer cannot add a recipient', async () => {
  const world = buildWorld();
  world.customerLinkStore.seed(USER, 'REJECTED');
  await assert.rejects(
    useCases(world).addRecipient({
      userId: USER,
      currency: 'EUR',
      country: 'DE',
      values: EUR_RECIPIENT_VALUES,
    }),
    CustomerNotVerifiedError,
  );
  assert.deepEqual(world.calls, []);
});
