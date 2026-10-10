import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../../shared/errors.ts';
import { parseDecimalToMinorUnits } from '../../../../shared/money.ts';
import {
  UnknownCurrencyError,
  type CurrencyRegistry,
} from '../../../../application/transfer/ports.ts';
import type { AccessTokenAuthenticator } from '../../../../application/auth/authenticate-access-token.ts';
import type { CurrencyCatalogue } from '../../../../application/payout/currency-catalogue.ts';
import type { RequestQuote } from '../../../../application/transfer/request-quote.ts';
import type {
  AddRecipient,
  GetRecipientForm,
  RemoveRecipient,
} from '../../../../application/transfer/add-recipient.ts';
import type { AttachRecipientToQuote } from '../../../../application/transfer/reprice-quote.ts';
import type {
  FundTransfer,
  GetTransferFunding,
} from '../../../../application/transfer/fund-transfer.ts';
import { PROVIDER_DISPLAY_NAMES } from '../../../../domain/payout/models.ts';
import type {
  ConfirmTransfer,
  GetTransferForm,
} from '../../../../application/transfer/confirm-transfer.ts';
import type { CancelTransfer } from '../../../../application/transfer/cancel-transfer.ts';
import type {
  GetTransferDetail,
  ListRecipients,
  ListTransfers,
  RefreshTransfer,
} from '../../../../application/transfer/transfer-queries.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { requireVerifiedEmail } from '../../middleware/require-verified-email.ts';
import { requireProviderVerified } from '../../middleware/require-provider-verified.ts';
import { validateRequest } from '../../middleware/validate-request.ts';
import { sensitiveRateLimiter } from '../../middleware/rate-limit.ts';
import { asyncHandler } from '../../middleware/async-handler.ts';
import { requirePrincipal } from '../../require-principal.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../validated-input.ts';
import { sendData } from '../../response.ts';
import type { RateLimitConfig } from '../../../../config/app-config.ts';
import { SendMoneyDtoFactory } from './send-money-dto.ts';

export interface SendMoneyRoutesDeps {
  readonly rateLimit: RateLimitConfig;
  readonly authenticator: AccessTokenAuthenticator;
  readonly currencyRegistry: CurrencyRegistry;
  readonly currencyCatalogue: CurrencyCatalogue;
  readonly requestQuote: RequestQuote;
  readonly getRecipientForm: GetRecipientForm;
  readonly addRecipient: AddRecipient;
  readonly listRecipients: ListRecipients;
  readonly removeRecipient: RemoveRecipient;
  readonly attachRecipientToQuote: AttachRecipientToQuote;
  readonly getTransferForm: GetTransferForm;
  readonly confirmTransfer: ConfirmTransfer;
  readonly getTransferDetail: GetTransferDetail;
  readonly getTransferFunding: GetTransferFunding;
  readonly fundTransfer: FundTransfer;
  readonly refreshTransfer: RefreshTransfer;
  readonly listTransfers: ListTransfers;
  readonly cancelTransfer: CancelTransfer;
  readonly transferPause: TransferPause;
}

import type { TransferPause } from '../../../../application/settings/transfer-pause.ts';

const currency = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase());
const country = z
  .string()
  .length(2)
  .transform((v) => v.toUpperCase());
const decimalAmount = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount');
const uuid = z.uuid();
const noBody = z.strictObject({});
const noQuery = z.strictObject({});

/** Values for a provider-defined form: flat string keys to string values. */
const formValues = z
  .record(z.string().min(1).max(64), z.string().max(500))
  .refine((values) => Object.keys(values).length <= 40, 'Too many fields');

const quoteBody = z.strictObject({
  sourceCurrency: currency,
  targetCurrency: currency,
  sourceAmount: decimalAmount.optional(),
  targetAmount: decimalAmount.optional(),
});

const recipientFormBody = z.strictObject({
  currency,
  country,
  quoteId: uuid.optional(),
  partialValues: formValues.optional(),
});

// A person's or business's name: letters, marks, digits, spaces and a few
// punctuation marks. No angle brackets or control characters, so a name can never
// carry markup into a client that renders it carelessly (a future web app).
const SAFE_NAME = /^[\p{L}\p{M}\p{N} .,'’&()/+-]+$/u;
const safeName = (max: number): z.ZodString =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(SAFE_NAME, 'Use letters, numbers and ordinary punctuation only');

const recipientBody = z.strictObject({
  currency,
  country,
  values: formValues.refine(
    (values) =>
      values.accountHolderName === undefined || SAFE_NAME.test(values.accountHolderName.trim()),
    { message: 'Use letters, numbers and ordinary punctuation only', path: ['accountHolderName'] },
  ),
  displayName: safeName(120).optional(),
});

const transferFormBody = z.strictObject({
  quoteId: uuid,
  recipientId: uuid,
  partialValues: formValues.optional(),
});
const confirmBody = z.strictObject({
  quoteId: uuid,
  recipientId: uuid,
  answers: formValues.default({}),
  // The customer's own reference for the recipient. Kept to what bank payment
  // schemes generally accept; the provider may still refuse it.
  reference: z
    .string()
    .trim()
    .min(1)
    .max(35)
    .regex(/^[A-Za-z0-9 .,/-]+$/, 'Use letters, numbers, spaces and . , / - only')
    .optional(),
});
const quoteRecipientBody = z.strictObject({ recipientId: uuid });
const fundBody = z.strictObject({ method: z.enum(['BANK_TRANSFER', 'BALANCE']) });
const listQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const idParams = z.strictObject({ id: uuid });
// SomPay's own UUID, created once by the client and reused on every retry.
const idempotencyKey = z.uuid();

export function sendMoneyRoutes(deps: SendMoneyRoutesDeps): Router {
  const router = Router();
  const dto = new SendMoneyDtoFactory(deps.currencyRegistry);
  const guard = [authenticate(deps.authenticator), requireVerifiedEmail()];
  // Everything that prices, prepares or moves money needs the provider to have
  // verified the customer (KYC). Reading one's own history, checking a status
  // and cancelling stay available, so a customer whose verification lapses can
  // still see and stop what they already started.
  const moneyGuard = [...guard, requireProviderVerified()];

  /** Parses a decimal amount using the currency's own exponent, from the provider. */
  const toMinor = async (amount: string, code: string, field: string): Promise<bigint> => {
    let exponent: number;
    try {
      exponent = await deps.currencyCatalogue.minorUnitExponent(code);
    } catch (error) {
      if (error instanceof UnknownCurrencyError) {
        throw new ValidationError('That currency is not supported.', [
          { field: 'body.sourceCurrency', message: 'Unsupported currency' },
        ]);
      }
      throw error;
    }
    try {
      return parseDecimalToMinorUnits(amount, exponent);
    } catch {
      throw new ValidationError('The amount has too many decimal places for that currency.', [
        { field: `body.${field}`, message: 'Invalid precision' },
      ]);
    }
  };

  // Whether new transfers can be started right now (an admin may have paused them).
  router.get(
    '/availability',
    authenticate(deps.authenticator),
    validateRequest({ query: noQuery }),
    asyncHandler(async (_req, res) => {
      const state = await deps.transferPause.status();
      sendData(res, {
        newTransfersPaused: state.paused,
        message: state.paused ? state.message : null,
      });
    }),
  );

  // --- What the provider supports (never hard-coded) -----------------------
  router.get(
    '/currencies',
    ...moneyGuard,
    validateRequest({ query: noQuery }),
    asyncHandler(async (_req, res) => {
      const { capabilities, currencies } = await deps.currencyCatalogue.get();
      sendData(res, {
        sourceCurrencies: capabilities.sourceCurrencies,
        targetCurrencies: capabilities.targetCurrencies,
        currencies,
        provider: {
          name: capabilities.provider,
          displayName: PROVIDER_DISPLAY_NAMES[capabilities.provider],
        },
        // Where each currency can be paid out, when the provider publishes it.
        payoutCountries: capabilities.payoutCountries ?? null,
        features: capabilities.features,
        unsupportedOperations: capabilities.unsupportedOperations,
      });
    }),
  );

  // --- Quotes -----------------------------------------------------
  router.post(
    '/quotes',
    ...moneyGuard,
    validateRequest({ body: quoteBody }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<z.infer<typeof quoteBody>>(req);
      if ((body.sourceAmount === undefined) === (body.targetAmount === undefined)) {
        throw new ValidationError('Give either the amount to send or the amount to receive.', [
          { field: 'body.sourceAmount', message: 'Provide sourceAmount or targetAmount, not both' },
        ]);
      }
      const quote = await deps.requestQuote({
        userId: requirePrincipal(req).userId,
        sourceCurrency: body.sourceCurrency,
        targetCurrency: body.targetCurrency,
        sourceAmountMinor:
          body.sourceAmount === undefined
            ? undefined
            : await toMinor(body.sourceAmount, body.sourceCurrency, 'sourceAmount'),
        targetAmountMinor:
          body.targetAmount === undefined
            ? undefined
            : await toMinor(body.targetAmount, body.targetCurrency, 'targetAmount'),
      });
      sendData(res, await dto.quote(quote), 201);
    }),
  );

  // Prices the quote for a chosen recipient. The price may change; the quote
  // returned (possibly a new one) is the one to review and confirm.
  router.post(
    '/quotes/:id/recipient',
    ...moneyGuard,
    validateRequest({ params: idParams, body: quoteRecipientBody }),
    asyncHandler(async (req, res) => {
      const { quote, priceChanged } = await deps.attachRecipientToQuote({
        userId: requirePrincipal(req).userId,
        quoteId: validatedParams<{ id: string }>(req).id,
        recipientId: validatedBody<z.infer<typeof quoteRecipientBody>>(req).recipientId,
      });
      sendData(res, { ...(await dto.quote(quote)), priceChanged });
    }),
  );

  // --- Recipients -----------------------------------------------
  router.get(
    '/recipients',
    ...moneyGuard,
    validateRequest({ query: noQuery }),
    asyncHandler(async (req, res) => {
      const recipients = await deps.listRecipients(requirePrincipal(req).userId);
      sendData(res, { recipients: recipients.map((r) => dto.recipient(r)) });
    }),
  );

  // POST because the request carries the values entered so far.
  router.post(
    '/recipient-form',
    ...moneyGuard,
    validateRequest({ body: recipientFormBody }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<z.infer<typeof recipientFormBody>>(req);
      const form = await deps.getRecipientForm({
        userId: requirePrincipal(req).userId,
        currency: body.currency,
        country: body.country,
        quoteId: body.quoteId,
        partialValues: body.partialValues,
      });
      sendData(res, form);
    }),
  );

  router.post(
    '/recipients',
    ...moneyGuard,
    validateRequest({ body: recipientBody }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<z.infer<typeof recipientBody>>(req);
      const recipient = await deps.addRecipient({
        userId: requirePrincipal(req).userId,
        currency: body.currency,
        country: body.country,
        values: body.values,
        displayName: body.displayName,
      });
      sendData(res, dto.recipient(recipient), 201);
    }),
  );

  // A soft delete: past transfers keep their recipient summary.
  router.delete(
    '/recipients/:id',
    ...moneyGuard,
    validateRequest({ params: idParams }),
    asyncHandler(async (req, res) => {
      await deps.removeRecipient(
        requirePrincipal(req).userId,
        validatedParams<{ id: string }>(req).id,
      );
      sendData(res, { status: 'removed' });
    }),
  );

  // --- Transfers ----------------------------------------------
  router.post(
    '/transfer-form',
    ...moneyGuard,
    validateRequest({ body: transferFormBody }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<z.infer<typeof transferFormBody>>(req);
      sendData(res, await deps.getTransferForm({ userId: requirePrincipal(req).userId, ...body }));
    }),
  );

  router.post(
    '/transfers',
    sensitiveRateLimiter(deps.rateLimit),
    ...moneyGuard,
    validateRequest({ body: confirmBody }),
    asyncHandler(async (req, res) => {
      const keyHeader = idempotencyKey.safeParse(req.get('idempotency-key'));
      if (!keyHeader.success) {
        throw new ValidationError('An Idempotency-Key header containing a UUID is required.');
      }
      const body = validatedBody<z.infer<typeof confirmBody>>(req);
      const result = await deps.confirmTransfer({
        userId: requirePrincipal(req).userId,
        quoteId: body.quoteId,
        recipientId: body.recipientId,
        answers: body.answers,
        reference: body.reference,
        idempotencyKey: keyHeader.data,
      });
      // 200 for a replayed idempotent request, 201 for a fresh transfer.
      sendData(res, await dto.transfer(result.transfer), result.wasExisting ? 200 : 201);
    }),
  );

  // History comes from SomPay's own database only; the provider is not called.
  router.get(
    '/transfers',
    ...guard,
    validateRequest({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const result = await deps.listTransfers(
        requirePrincipal(req).userId,
        validatedQuery<z.infer<typeof listQuery>>(req),
      );
      sendData(res, {
        transfers: await Promise.all(
          result.transfers.map(async (t) => {
            const recipient = result.recipients.get(t.recipientId);
            return {
              ...(await dto.transfer(t)),
              recipient: recipient ? dto.recipient(recipient) : null,
            };
          }),
        ),
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
      });
    }),
  );

  router.get(
    '/transfers/:id',
    ...guard,
    validateRequest({ params: idParams, query: noQuery }),
    asyncHandler(async (req, res) => {
      const detail = await deps.getTransferDetail(
        requirePrincipal(req).userId,
        validatedParams<{ id: string }>(req).id,
      );
      sendData(res, {
        ...(await dto.transfer(detail.transfer)),
        recipient: detail.recipient ? dto.recipient(detail.recipient) : null,
        // Only what was applied: events ignored as out of order stay in the record.
        timeline: detail.events
          .filter((event) => event.applied)
          .map((event) => ({
            status: event.status,
            occurredAt: event.occurredAt.toISOString(),
          })),
      });
    }),
  );

  // --- Paying the provider -------------------------------------------------
  // The bank details are the provider's, fetched from it now. Never SomPay's.
  router.get(
    '/transfers/:id/funding',
    ...moneyGuard,
    validateRequest({ params: idParams, query: noQuery }),
    asyncHandler(async (req, res) => {
      const funding = await deps.getTransferFunding(
        requirePrincipal(req).userId,
        validatedParams<{ id: string }>(req).id,
      );
      const methods = await Promise.all(
        funding.methods.map(async (m) =>
          m.method === 'BANK_TRANSFER'
            ? {
                method: m.method,
                amount: await dto.money(m.amount),
                bankDetails: m.bankDetails,
                reference: m.reference,
              }
            : { method: m.method, amount: await dto.money(m.amount) },
        ),
      );
      // Bank details must not sit in any cache between the provider and the customer.
      res.setHeader('Cache-Control', 'no-store');
      sendData(res, { transferId: funding.transfer.id, provider: funding.provider, methods });
    }),
  );

  router.post(
    '/transfers/:id/fund',
    sensitiveRateLimiter(deps.rateLimit),
    ...moneyGuard,
    validateRequest({ params: idParams, body: fundBody }),
    asyncHandler(async (req, res) => {
      const result = await deps.fundTransfer({
        userId: requirePrincipal(req).userId,
        transferId: validatedParams<{ id: string }>(req).id,
        method: validatedBody<z.infer<typeof fundBody>>(req).method,
      });
      sendData(res, {
        outcome: result.outcome,
        message: result.message ?? null,
        transfer: await dto.transfer(result.transfer),
      });
    }),
  );

  // An explicit provider lookup. History reads above never call the provider.
  router.post(
    '/transfers/:id/refresh',
    sensitiveRateLimiter(deps.rateLimit),
    ...guard,
    validateRequest({ params: z.strictObject({ id: uuid }), body: noBody }),
    asyncHandler(async (req, res) => {
      const transfer = await deps.refreshTransfer(
        requirePrincipal(req).userId,
        validatedParams<{ id: string }>(req).id,
      );
      sendData(res, await dto.transfer(transfer));
    }),
  );

  router.post(
    '/transfers/:id/cancel',
    ...guard,
    validateRequest({ params: z.strictObject({ id: uuid }), body: noBody }),
    asyncHandler(async (req, res) => {
      const transfer = await deps.cancelTransfer(
        requirePrincipal(req).userId,
        validatedParams<{ id: string }>(req).id,
      );
      sendData(res, await dto.transfer(transfer));
    }),
  );

  return router;
}
