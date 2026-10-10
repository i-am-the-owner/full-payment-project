import { Router, type Request } from 'express';
import { z } from 'zod';
import type { RateLimitConfig } from '../../../../config/app-config.ts';
import type { AccessTokenAuthenticator } from '../../../../application/auth/authenticate-access-token.ts';
import type { RegisterUser } from '../../../../application/auth/register-user.ts';
import type { LoginUser } from '../../../../application/auth/login-user.ts';
import type { RefreshSession } from '../../../../application/auth/refresh-session.ts';
import type { Logout, LogoutAll } from '../../../../application/auth/logout.ts';
import type {
  ResendEmailVerification,
  VerifyEmail,
} from '../../../../application/auth/verify-email.ts';
import type {
  RequestPasswordReset,
  ResetPassword,
} from '../../../../application/auth/password-reset.ts';
import type { ConfirmPassword } from '../../../../application/auth/confirm-password.ts';
import type { TwoFactor } from '../../../../application/auth/two-factor.ts';
import type { GetCurrentUser } from '../../../../application/auth/get-current-user.ts';
import type { IssuedTokens } from '../../../../domain/auth/session.ts';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate-request.ts';
import { sensitiveRateLimiter } from '../../middleware/rate-limit.ts';
import { asyncHandler } from '../../middleware/async-handler.ts';
import { requirePrincipal } from '../../require-principal.ts';
import { validatedBody } from '../../validated-input.ts';
import { sendData } from '../../response.ts';

export interface AuthRoutesDeps {
  readonly rateLimit: RateLimitConfig;
  readonly authenticator: AccessTokenAuthenticator;
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly refreshSession: RefreshSession;
  readonly logout: Logout;
  readonly logoutAll: LogoutAll;
  readonly verifyEmail: VerifyEmail;
  readonly resendEmailVerification: ResendEmailVerification;
  readonly requestPasswordReset: RequestPasswordReset;
  readonly resetPassword: ResetPassword;
  readonly getCurrentUser: GetCurrentUser;
  readonly twoFactor: TwoFactor;
  readonly confirmPassword: ConfirmPassword;
}

const emailField = z
  .string()
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email());
const passwordField = z.string().min(1).max(256);
const opaqueToken = z.string().min(16).max(512);
const totpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

function userAgentOf(req: Request): string | undefined {
  return req.get('user-agent');
}

function tokenPayload(tokens: IssuedTokens): Record<string, unknown> {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: tokens.accessTokenExpiresInSeconds,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
  };
}

/** `/api/v1/auth/*` – registration, login, sessions, email verification, password reset. */
export function authRoutes(deps: AuthRoutesDeps): Router {
  const router = Router();

  // Every auth endpoint is rate limited per client, on top of any per-account lock.
  router.use(sensitiveRateLimiter(deps.rateLimit));

  router.post(
    '/register',
    validateRequest({ body: z.strictObject({ email: emailField, password: passwordField }) }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<{ email: string; password: string }>(req);
      await deps.registerUser({
        email: body.email,
        password: body.password,
        ipAddress: req.ip,
        requestId: req.id,
      });
      // Identical response whether or not the email already existed.
      sendData(res, { status: 'pending_verification' }, 202);
    }),
  );

  router.post(
    '/login',
    validateRequest({
      body: z.strictObject({
        email: emailField,
        password: passwordField,
        totpCode: totpCode.optional(),
        recoveryCode: z.string().trim().min(8).max(32).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<{
        email: string;
        password: string;
        totpCode?: string;
        recoveryCode?: string;
      }>(req);
      const result = await deps.loginUser({
        email: body.email,
        password: body.password,
        totpCode: body.totpCode,
        recoveryCode: body.recoveryCode,
        userAgent: userAgentOf(req),
        ipAddress: req.ip,
        requestId: req.id,
      });
      sendData(res, { ...tokenPayload(result.tokens), user: result.user });
    }),
  );

  router.post(
    '/refresh',
    validateRequest({ body: z.strictObject({ refreshToken: opaqueToken }) }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<{ refreshToken: string }>(req);
      const tokens = await deps.refreshSession({
        refreshToken: body.refreshToken,
        userAgent: userAgentOf(req),
        ipAddress: req.ip,
      });
      sendData(res, tokenPayload(tokens));
    }),
  );

  router.post(
    '/logout',
    optionalAuthenticate(deps.authenticator),
    validateRequest({ body: z.strictObject({ refreshToken: opaqueToken.optional() }) }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<{ refreshToken?: string }>(req);
      await deps.logout({
        sessionId: req.auth?.sessionId,
        refreshToken: body.refreshToken,
        actorId: req.auth?.userId,
        requestId: req.id,
      });
      sendData(res, { status: 'signed_out' });
    }),
  );

  router.post(
    '/logout-all',
    authenticate(deps.authenticator),
    validateRequest({ body: z.strictObject({}) }),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      await deps.logoutAll(principal.userId, req.id);
      sendData(res, { status: 'all_sessions_revoked' });
    }),
  );

  router.post(
    '/email/verify',
    validateRequest({ body: z.strictObject({ token: opaqueToken }) }),
    asyncHandler(async (req, res) => {
      await deps.verifyEmail(validatedBody<{ token: string }>(req).token);
      sendData(res, { status: 'verified' });
    }),
  );

  router.post(
    '/email/resend',
    authenticate(deps.authenticator),
    validateRequest({ body: z.strictObject({}) }),
    asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const user = await deps.getCurrentUser(principal.userId);
      await deps.resendEmailVerification({
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        ipAddress: req.ip,
      });
      sendData(res, { status: 'sent' });
    }),
  );

  router.post(
    '/password/forgot',
    validateRequest({ body: z.strictObject({ email: emailField }) }),
    asyncHandler(async (req, res) => {
      await deps.requestPasswordReset({
        email: validatedBody<{ email: string }>(req).email,
        ipAddress: req.ip,
        requestId: req.id,
      });
      // Identical response whether or not the email exists.
      sendData(res, { status: 'pending' }, 202);
    }),
  );

  router.post(
    '/password/reset',
    validateRequest({
      body: z.strictObject({ token: opaqueToken, newPassword: passwordField }),
    }),
    asyncHandler(async (req, res) => {
      const body = validatedBody<{ token: string; newPassword: string }>(req);
      await deps.resetPassword({
        token: body.token,
        newPassword: body.newPassword,
        requestId: req.id,
      });
      sendData(res, { status: 'reset' });
    }),
  );

  // --- Optional two-step sign-in (TOTP) ------------------------------------
  router.post(
    '/2fa/setup',
    authenticate(deps.authenticator),
    // The password is asked for again: a stolen access token must not be able
    // to attach someone else's authenticator to the account.
    validateRequest({ body: z.strictObject({ password: passwordField }) }),
    asyncHandler(async (req, res) => {
      const userId = requirePrincipal(req).userId;
      await deps.confirmPassword(userId, validatedBody<{ password: string }>(req).password);
      sendData(res, await deps.twoFactor.setup(userId));
    }),
  );

  router.post(
    '/2fa/enable',
    authenticate(deps.authenticator),
    validateRequest({ body: z.strictObject({ code: totpCode }) }),
    asyncHandler(async (req, res) => {
      const { recoveryCodes } = await deps.twoFactor.enable(
        requirePrincipal(req).userId,
        validatedBody<{ code: string }>(req).code,
      );
      // The only time the recovery codes are shown; only their hashes are kept.
      sendData(res, { status: 'enabled', recoveryCodes });
    }),
  );

  router.post(
    '/2fa/recovery-codes',
    authenticate(deps.authenticator),
    validateRequest({ body: z.strictObject({ code: totpCode, password: passwordField }) }),
    asyncHandler(async (req, res) => {
      const userId = requirePrincipal(req).userId;
      const body = validatedBody<{ code: string; password: string }>(req);
      await deps.confirmPassword(userId, body.password);
      sendData(res, await deps.twoFactor.regenerateRecoveryCodes(userId, body.code));
    }),
  );

  router.post(
    '/2fa/disable',
    authenticate(deps.authenticator),
    validateRequest({ body: z.strictObject({ code: totpCode, password: passwordField }) }),
    asyncHandler(async (req, res) => {
      const userId = requirePrincipal(req).userId;
      const body = validatedBody<{ code: string; password: string }>(req);
      await deps.confirmPassword(userId, body.password);
      await deps.twoFactor.disable(userId, body.code);
      sendData(res, { status: 'disabled' });
    }),
  );

  return router;
}
