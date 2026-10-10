import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AccessTokenAuthenticator } from '../../../../application/auth/authenticate-access-token.ts';
import type { GetCurrentUser } from '../../../../application/auth/get-current-user.ts';
import type { CustomerOnboarding } from '../../../../application/payout/customer-onboarding.ts';
import {
  isCompleteProfile,
  type CustomerProfiles,
  type SenderCountries,
} from '../../../../application/payout/customer-profile.ts';
import type { RateLimitConfig } from '../../../../config/app-config.ts';
import { AppError } from '../../../../shared/errors.ts';
import { PayoutError } from '../../../../domain/payout/errors.ts';
import { asyncHandler } from '../../middleware/async-handler.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { sensitiveRateLimiter } from '../../middleware/rate-limit.ts';
import { requireVerifiedEmail } from '../../middleware/require-verified-email.ts';
import { validateRequest } from '../../middleware/validate-request.ts';
import { requirePrincipal } from '../../require-principal.ts';
import { sendData } from '../../response.ts';
import { validatedBody } from '../../validated-input.ts';

export interface OnboardingRoutesDeps {
  readonly rateLimit: RateLimitConfig;
  readonly authenticator: AccessTokenAuthenticator;
  readonly getCurrentUser: GetCurrentUser;
  readonly customerProfiles: CustomerProfiles;
  readonly senderCountries: SenderCountries;
  readonly customerOnboarding: CustomerOnboarding;
}

// Strict: there is no field through which a customer could set their own
// verification status.
const profileBody = z.strictObject({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  dateOfBirth: z.string().max(10),
  countryOfResidence: z.string().max(2),
  phone: z.string().max(24),
});
const noBody = z.strictObject({});
const noQuery = z.strictObject({});

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A minimal page for the customer's browser or in-app web view. No scripts. */
function page(res: Response, status: number, title: string, message: string): void {
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>${escapeHtml(title)}</title></head><body>` +
        `<main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>` +
        `</body></html>`,
    );
}

export function onboardingRoutes(deps: OnboardingRoutesDeps): Router {
  const router = Router();
  const signedIn = [authenticate(deps.authenticator)];
  const guard = [...signedIn, requireVerifiedEmail()];

  // --- Profile ------------------------------------------------------------
  router.get(
    '/profile',
    ...signedIn,
    validateRequest({ query: noQuery }),
    asyncHandler(async (req, res) => {
      const profile = await deps.customerProfiles.get(requirePrincipal(req).userId);
      sendData(res, {
        profile,
        complete: isCompleteProfile(profile),
        supportedCountries: await deps.senderCountries.list(),
      });
    }),
  );

  router.put(
    '/profile',
    ...guard,
    validateRequest({ body: profileBody }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<z.infer<typeof profileBody>>(req);
      const profile = await deps.customerProfiles.update(requirePrincipal(req).userId, body);
      sendData(res, { profile, complete: true });
    }),
  );

  // --- Identity check, run by the payout provider -------------------------
  router.get(
    '/onboarding/status',
    ...signedIn,
    validateRequest({ query: noQuery }),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const [status, profile] = await Promise.all([
        deps.customerOnboarding.refreshStatus(principal.userId),
        deps.customerProfiles.get(principal.userId),
      ]);
      sendData(res, {
        status,
        emailVerified: principal.emailVerified,
        profileComplete: isCompleteProfile(profile),
      });
    }),
  );

  router.post(
    '/onboarding/start',
    sensitiveRateLimiter(deps.rateLimit),
    ...guard,
    validateRequest({ body: noBody }),
    asyncHandler(async (req, res) => {
      sendData(res, await deps.customerOnboarding.start(requirePrincipal(req).userId));
    }),
  );

  /**
   * Where the provider sends the customer's browser when its identity check is
   * finished. There is no bearer token on a browser redirect: the single-use
   * `state` we issued in `/onboarding/start` is what identifies the customer
   * and protects against a forged callback.
   */
  router.get(
    '/onboarding/callback',
    sensitiveRateLimiter(deps.rateLimit),
    asyncHandler(async (req, res) => {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string' && key.length <= 64 && value.length <= 2000) {
          params[key] = value;
        }
      }
      try {
        const status = await deps.customerOnboarding.handleCallback(params.state, params);
        req.log.info('onboarding.callback.completed', { status });
        page(
          res,
          200,
          'Thank you',
          'Your identity check has been submitted. You can now return to the SomPay app.',
        );
      } catch (error) {
        if (error instanceof AppError || error instanceof PayoutError) {
          req.log.warn('onboarding.callback.failed', { code: error.code });
          page(
            res,
            error instanceof AppError ? error.httpStatus : 400,
            'Something went wrong',
            error.message,
          );
          return;
        }
        throw error;
      }
    }),
  );

  return router;
}
