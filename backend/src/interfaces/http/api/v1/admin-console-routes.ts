import { Router } from 'express';
import { z } from 'zod';
import type {
  AdminQueries,
  AdminTransferRow,
  AdminWebhookRow,
} from '../../../../application/admin/admin-queries.ts';
import type { TransferPause } from '../../../../application/settings/transfer-pause.ts';
import { NotFoundError } from '../../../../shared/errors.ts';
import { asyncHandler } from '../../middleware/async-handler.ts';
import { validateRequest } from '../../middleware/validate-request.ts';
import { requirePrincipal } from '../../require-principal.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../validated-input.ts';
import { sendData } from '../../response.ts';

export interface AdminConsoleDeps {
  readonly adminQueries: AdminQueries;
  /** Display-only USD rates for the dashboard, e.g. { GBP: '1.27' }. */
  readonly usdRates: Readonly<Record<string, string>>;
  readonly monthlyTargetUsd: number;
  readonly transferPause: TransferPause;
  /** The configured per-customer limits (decimal strings in `currency`). */
  readonly transferLimits: {
    readonly currency: string;
    readonly perTransfer: string;
    readonly perDay: string;
    readonly perMonth: string;
  };
}

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

const page = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};

const transferOut = (t: AdminTransferRow): Record<string, unknown> => ({
  ...t,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
const webhookOut = (w: AdminWebhookRow): Record<string, unknown> => ({
  ...w,
  receivedAt: w.receivedAt.toISOString(),
  processedAt: iso(w.processedAt),
});

const pauseOut = (s: {
  paused: boolean;
  message: string;
  updatedAt: Date | null;
}): Record<string, unknown> => ({
  paused: s.paused,
  message: s.message,
  updatedAt: iso(s.updatedAt),
});

/** Decimal rate string to a scaled integer (6 decimals), so no float touches money. */
function scaledRate(rate: string): bigint | null {
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(rate);
  return m ? BigInt(m[1]! + (m[2] ?? '').padEnd(6, '0')) : null;
}

/** Approximate USD (whole dollars) of a minor-unit amount, or null when no rate is configured. */
export function approxUsd(
  minor: string,
  currency: string,
  rates: Record<string, string>,
): number | null {
  const rate = currency === 'USD' ? 1_000_000n : scaledRate(rates[currency] ?? '');
  if (rate === null) return null;
  return Number((BigInt(minor) * rate) / 100n / 1_000_000n);
}

/**
 * The admin console's READ-ONLY endpoints. Mounted behind `authenticate` and
 * `adminGate` (admin role + 2FA + audit record before every request). There is
 * no POST, PUT, PATCH or DELETE here: an admin cannot change an amount, a
 * status or a recipient. Suspension and alert resolution live in `admin-routes.ts`.
 */
export function adminConsoleRoutes(deps: AdminConsoleDeps): Router {
  const router = Router();
  const q = deps.adminQueries;

  router.get(
    '/users',
    validateRequest({
      query: z.strictObject({ q: z.string().trim().max(100).optional(), ...page }),
    }),
    asyncHandler(async (req, res) => {
      const query = validatedQuery<{ q?: string; limit: number; offset: number }>(req);
      const users = await q.searchUsers(query);
      sendData(res, { users: users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })) });
    }),
  );

  router.get(
    '/users/:id',
    validateRequest({ params: z.strictObject({ id: z.uuid() }), query: z.strictObject({}) }),
    asyncHandler(async (req, res) => {
      const user = await q.getUser(validatedParams<{ id: string }>(req).id);
      if (!user) throw new NotFoundError('There is no such user.');
      sendData(res, {
        user: {
          ...user,
          createdAt: user.createdAt.toISOString(),
          lastLoginAt: iso(user.lastLoginAt),
          providerLinks: user.providerLinks.map((l) => ({
            ...l,
            linkedAt: l.linkedAt.toISOString(),
            updatedAt: l.updatedAt.toISOString(),
          })),
          recentAudit: user.recentAudit.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
          })),
        },
      });
    }),
  );

  router.get(
    '/transfers',
    validateRequest({
      query: z.strictObject({
        id: z.string().trim().min(1).max(100).optional(),
        userId: z.uuid().optional(),
        status: z
          .enum([
            'DRAFT',
            'AWAITING_FUNDS',
            'PROCESSING',
            'SENT',
            'COMPLETED',
            'CANCELLED',
            'REFUNDED',
            'FAILED',
          ])
          .optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        ...page,
      }),
    }),
    asyncHandler(async (req, res) => {
      const transfers = await q.searchTransfers(validatedQuery(req));
      sendData(res, { transfers: transfers.map(transferOut) });
    }),
  );

  router.get(
    '/transfers/:id',
    validateRequest({ params: z.strictObject({ id: z.uuid() }), query: z.strictObject({}) }),
    asyncHandler(async (req, res) => {
      const t = await q.getTransfer(validatedParams<{ id: string }>(req).id);
      if (!t) throw new NotFoundError('There is no such transfer.');
      sendData(res, {
        transfer: {
          ...transferOut(t),
          feeAmountMinor: t.feeAmountMinor,
          totalToPayMinor: t.totalToPayMinor,
          exchangeRate: t.exchangeRate,
          fundingMethod: t.fundingMethod,
          providerTransferId: t.providerTransferId,
          failureReason: t.failureReason,
          events: t.events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
          webhooks: t.webhooks.map(webhookOut),
        },
      });
    }),
  );

  router.get(
    '/reports/stuck-transfers',
    validateRequest({
      query: z.strictObject({
        olderThanHours: z.coerce
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .default(24),
        includeDrafts: z.enum(['true', 'false']).default('false'),
        ...page,
      }),
    }),
    asyncHandler(async (req, res) => {
      const f = validatedQuery<{
        olderThanHours: number;
        includeDrafts: string;
        limit: number;
        offset: number;
      }>(req);
      const rows = await q.stuckTransfers({ ...f, includeDrafts: f.includeDrafts === 'true' });
      sendData(res, { transfers: rows.map(transferOut) });
    }),
  );

  router.get(
    '/reports/failed-transfers',
    validateRequest({ query: z.strictObject(page) }),
    asyncHandler(async (req, res) => {
      const rows = await q.failedTransfers(validatedQuery(req));
      sendData(res, { transfers: rows.map(transferOut) });
    }),
  );

  router.get(
    '/reports/webhook-errors',
    validateRequest({ query: z.strictObject(page) }),
    asyncHandler(async (req, res) => {
      const rows = await q.webhookErrors(validatedQuery(req));
      sendData(res, { webhooks: rows.map(webhookOut) });
    }),
  );

  router.get(
    '/reports/identity-reviews',
    validateRequest({ query: z.strictObject(page) }),
    asyncHandler(async (req, res) => {
      const rows = await q.identityReviews(validatedQuery(req));
      sendData(res, { reviews: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
    }),
  );

  router.get(
    '/dashboard',
    validateRequest({
      query: z.strictObject({
        period: z.enum(['day', 'month']).default('day'),
        days: z.coerce.number().int().min(1).max(366).default(31),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { period, days } = validatedQuery<{ period: 'day' | 'month'; days: number }>(req);
      const to = new Date(Date.now() + 1000);
      const from = new Date(to.getTime() - days * 86_400_000);
      const rows = await q.volume({ period, from, to });
      // This month's volume against the target, in approximate USD.
      const monthStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
      const month = await q.volume({ period: 'month', from: monthStart, to });
      let monthUsd: number | null = 0;
      for (const r of month) {
        const usd = approxUsd(r.volumeMinor, r.currency, deps.usdRates);
        monthUsd = usd === null || monthUsd === null ? null : monthUsd + usd;
      }
      sendData(res, {
        period,
        rows: rows.map((r) => ({
          ...r,
          approxUsd: approxUsd(r.volumeMinor, r.currency, deps.usdRates),
        })),
        limits: deps.transferLimits,
        transfersPaused: pauseOut(await deps.transferPause.status()),
        thisMonth: {
          approxUsd: monthUsd,
          targetUsd: deps.monthlyTargetUsd,
          note: 'Approximate: uses the display rates in DASHBOARD_USD_RATES. Not an accounting figure.',
        },
      });
    }),
  );

  router.get(
    '/settings',
    validateRequest({ query: z.strictObject({}) }),
    asyncHandler(async (_req, res) => {
      sendData(res, {
        limits: deps.transferLimits,
        transfersPaused: pauseOut(await deps.transferPause.status()),
      });
    }),
  );

  // The one switch that changes how the service behaves. It needs the admin's
  // current authenticator code on top of the 2FA session, and is audited twice
  // (the gate's access record and `admin.transfers.paused|resumed`).
  router.put(
    '/settings/transfers-paused',
    validateRequest({
      body: z.strictObject({
        paused: z.boolean(),
        message: z.string().trim().min(5).max(300).optional(),
        code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<{ paused: boolean; message?: string; code: string }>(req);
      const state = await deps.transferPause.setPaused({
        adminUserId: requirePrincipal(req).userId,
        ...body,
      });
      sendData(res, { transfersPaused: pauseOut(state) });
    }),
  );

  return router;
}
