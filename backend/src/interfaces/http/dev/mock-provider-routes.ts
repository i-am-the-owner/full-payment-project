import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AccessTokenAuthenticator } from '../../../application/auth/authenticate-access-token.ts';
import type { ReceiveProviderWebhook } from '../../../application/transfer/receive-provider-webhook.ts';
import type { GetTransfer } from '../../../application/transfer/transfer-queries.ts';
import type { JobRunner } from '../../../application/jobs/job-runner.ts';
import { ConflictError } from '../../../shared/errors.ts';
import type { MockPayoutProvider } from '../../../infrastructure/providers/mock/mock-payout-provider.ts';
import { MOCK_TRANSFER_STATUSES } from '../../../infrastructure/providers/mock/mock-status-mapping.ts';
import { asyncHandler } from '../middleware/async-handler.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { validateRequest } from '../middleware/validate-request.ts';
import { requirePrincipal } from '../require-principal.ts';
import { validatedBody, validatedParams } from '../validated-input.ts';
import { sendData } from '../response.ts';

export interface MockProviderRoutesDeps {
  readonly mockProvider: MockPayoutProvider;
  readonly authenticator: AccessTokenAuthenticator;
  readonly getTransfer: GetTransfer;
  readonly receiveProviderWebhook: ReceiveProviderWebhook;
  /** Runs queued jobs now, so a dev tool shows its effect at once. */
  readonly jobRunner: JobRunner;
  /** This backend's public base URL: the only place the mock KYC page will send anyone. */
  readonly publicApiUrl: string;
}

const advanceBody = z.strictObject({ status: z.enum(MOCK_TRANSFER_STATUSES).optional() });
const webhookBody = z.strictObject({
  status: z.enum(MOCK_TRANSFER_STATUSES),
  /** Date the event this many seconds in the past: an out-of-order delivery. */
  secondsAgo: z.number().int().min(0).max(86_400).default(0),
  /** Deliver it this many times with the SAME event id: duplicate deliveries. */
  times: z.number().int().min(1).max(5).default(1),
});

/**
 * DEV ONLY. Mounted only when `PAYOUT_PROVIDER=mock` outside production.
 *
 * `POST /dev/mock/transfers/:id/advance` moves one of the caller's own
 * transfers to its next mock status (or to `status`) and delivers the signed
 * webhook the mock provider would send. The webhook goes through the same
 * verification and handling as a real one – this endpoint cannot set a status
 * directly.
 */
export function mockProviderRoutes(deps: MockProviderRoutesDeps): Router {
  const router = Router();

  router.post(
    '/transfers/:id/advance',
    authenticate(deps.authenticator),
    validateRequest({ params: z.strictObject({ id: z.uuid() }), body: advanceBody }),
    asyncHandler(async (req, res) => {
      const userId = requirePrincipal(req).userId;
      const id = validatedParams<{ id: string }>(req).id;
      const transfer = await deps.getTransfer(userId, id);
      if (!transfer.providerTransferId || transfer.provider !== 'mock') {
        throw new ConflictError('That transfer has not been submitted to the mock provider.');
      }

      const body = validatedBody<z.infer<typeof advanceBody>>(req);
      const webhook = deps.mockProvider.advanceTransfer(transfer.providerTransferId, body.status);
      const webhookOutcome = await deps.receiveProviderWebhook({ ...webhook, requestId: req.id });
      // Webhooks are processed in the background; in development do it now.
      await deps.jobRunner.drain();

      const updated = await deps.getTransfer(userId, id);
      sendData(res, { id: updated.id, status: updated.status, webhookOutcome });
    }),
  );

  /**
   * Sends one of the caller's own transfers a signed webhook for ANY mock
   * status, as the provider would, without changing the transfer at the mock
   * provider. Use `secondsAgo` for an out-of-order event and `times` for
   * duplicates. It goes through the same receive and process path as a real
   * webhook; it cannot set a status directly.
   */
  router.post(
    '/transfers/:id/webhook',
    authenticate(deps.authenticator),
    validateRequest({ params: z.strictObject({ id: z.uuid() }), body: webhookBody }),
    asyncHandler(async (req, res) => {
      const userId = requirePrincipal(req).userId;
      const id = validatedParams<{ id: string }>(req).id;
      const transfer = await deps.getTransfer(userId, id);
      if (!transfer.providerTransferId || transfer.provider !== 'mock') {
        throw new ConflictError('That transfer has not been submitted to the mock provider.');
      }
      const body = validatedBody<z.infer<typeof webhookBody>>(req);
      const eventId = randomUUID();
      const occurredAt = new Date(Date.now() - body.secondsAgo * 1000);
      const outcomes: string[] = [];
      for (let i = 0; i < body.times; i += 1) {
        const webhook = deps.mockProvider.simulateTransferEvent(
          transfer.providerTransferId,
          body.status,
          { occurredAt, eventId },
        );
        outcomes.push(await deps.receiveProviderWebhook({ ...webhook, requestId: req.id }));
      }
      await deps.jobRunner.drain();
      const updated = await deps.getTransfer(userId, id);
      sendData(res, { id: updated.id, status: updated.status, webhookOutcomes: outcomes });
    }),
  );

  /**
   * The mock provider's "hosted identity check". It stands in for the page a
   * real provider shows, and sends the customer back to our callback with the
   * outcome they pick. `return_url` must be this backend's own callback, so the
   * page cannot be used to redirect anywhere else.
   */
  router.get('/kyc', (req, res) => {
    const returnUrl = typeof req.query.return_url === 'string' ? req.query.return_url : '';
    let target: URL | undefined;
    try {
      target = new URL(returnUrl);
    } catch {
      target = undefined;
    }
    if (
      !target ||
      target.origin !== new URL(deps.publicApiUrl).origin ||
      target.pathname !== '/api/v1/onboarding/callback'
    ) {
      res
        .status(400)
        .type('html')
        .send('<!doctype html><title>Invalid link</title><p>Invalid link.</p>');
      return;
    }
    const link = (outcome: string, label: string): string => {
      const url = new URL(target.toString());
      url.searchParams.set('mock_outcome', outcome);
      return `<li><a href="${url.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${label}</a></li>`;
    };
    res
      .status(200)
      .type('html')
      .send(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<title>Mock identity check</title></head><body><main>' +
          '<h1>Mock identity check</h1>' +
          "<p>This page stands in for the payment provider's identity check. " +
          'It exists only in development. Choose what the provider should decide:</p><ul>' +
          link('approved', 'Approve: identity verified') +
          link('pending', 'Leave pending: still being checked') +
          link('rejected', 'Reject: could not verify') +
          '</ul></main></body></html>',
      );
  });

  return router;
}
