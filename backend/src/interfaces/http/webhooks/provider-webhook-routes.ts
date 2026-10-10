import express, { Router } from 'express';
import type { ReceiveProviderWebhook } from '../../../application/transfer/receive-provider-webhook.ts';
import type { WebhookHeaders } from '../../../domain/payout/models.ts';
import { asyncHandler } from '../middleware/async-handler.ts';
import '../express-augmentation.ts';

export interface ProviderWebhookRoutesDeps {
  /** The active provider's name; webhooks addressed to any other are refused. */
  readonly providerName: string;
  readonly receiveProviderWebhook: ReceiveProviderWebhook;
}

const RAW_BODY_LIMIT = '128kb';

/** Flattens Express headers to single lower-cased string values. */
export function toWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): WebhookHeaders {
  const flat: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    flat[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}

/**
 * `POST /webhooks/:provider` – inbound status notifications from the payout
 * provider.
 *
 * Mounted OUTSIDE `/api` and before the JSON body parser: signature
 * verification needs the exact raw bytes the provider signed. A bad signature
 * is rejected with 401; a verified but unhandled event is acknowledged with 200
 * so the provider stops retrying.
 */
export function providerWebhookRoutes(deps: ProviderWebhookRoutesDeps): Router {
  const router = Router();

  router.post(
    '/:provider',
    express.raw({ type: '*/*', limit: RAW_BODY_LIMIT }),
    asyncHandler(async (req, res) => {
      if (req.params.provider !== deps.providerName) {
        res.status(404).json({ error: { code: 'NOT_FOUND' } });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const outcome = await deps.receiveProviderWebhook({
        headers: toWebhookHeaders(req.headers),
        rawBody,
        requestId: req.id,
      });
      if (outcome === 'invalid_signature') {
        res.status(401).json({ error: { code: 'INVALID_SIGNATURE' } });
        return;
      }
      res.status(200).json({ status: outcome });
    }),
  );

  return router;
}
