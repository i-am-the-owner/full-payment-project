# 8. Authentication architecture

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Milestone 5 implements production-oriented authentication: registration, login,
sessions, logout, email verification, password reset, account lockout, backend
authorization, and secure token storage in the mobile app. No money-movement or
Wise code is included.

## Decisions

### Passwords

- **Argon2id** via `@node-rs/argon2` (prebuilt binaries), OWASP parameters
  (m = 19 MiB, t = 2, p = 1). Never stored or logged in plaintext.
- `PasswordHasher.needsRehash` re-hashes on the next successful login if the
  parameters are ever strengthened.
- Policy (`domain/auth/password-policy.ts`): length-first (min 12, max 128), plus
  rejection of single-character and a small denylist. **No** composition rules.
  A breached-password check (HIBP range API) is a documented follow-up.

### Tokens & sessions

- **Access token:** stateless HS256 JWT, 15-minute TTL, `algorithms:['HS256']`
  pinned, `iss`/`aud` checked, carries `sub`, `sid` (session id), `roles`, `jti`.
- **Refresh token:** opaque 256-bit random, returned once, stored only as a
  SHA-256 hash in `auth_sessions`. **Rotates on every use.** Presenting a
  `rotated`/`revoked` refresh token ⇒ the whole `family_id` is revoked
  (reuse detection; a stolen token and the real one are indistinguishable).
- **Immediate revocation:** `authenticate` verifies the JWT _and_ that the
  session row is still `active` and the account still `active`, on every request
  (one indexed lookup). Logout / password reset / suspension take effect at once,
  not after the access-token TTL.
- `refresh_token_ttl` 30 days (absolute); `email_verification` 24 h;
  `password_reset` 60 min. Verification and reset tokens are single-use, stored
  hashed, in one `auth_tokens` table keyed by `purpose`.

### Account protection

- **Per-account lockout:** `user_auth.failed_login_attempts` increments on each
  bad password; at the threshold (5) `locked_until` is set (15 min). Cleared on
  a successful login. All done in one atomic `UPDATE`.
- **Per-client rate limiting:** the `/api/v1/auth/*` router carries the stricter
  `sensitiveRateLimiter` on top of the global limiter.
- **No enumeration:** registration and `password/forgot` always return an
  identical response; login always returns the same generic 401 and always runs
  an Argon2 verification (against a fixed dummy hash if the account is unknown)
  to equalise timing.

### Flows

- Registration returns **202 with no tokens** — the user verifies their email
  (optional gate via `requireVerifiedEmail`, for money features later) and then
  logs in. This keeps the response identical for new vs. existing emails.
- Password reset sets the new hash, **revokes every session**, invalidates other
  pending reset tokens, and emails a "password changed" notice.

### Authorization middleware

`authenticate` → `req.auth`; `authorize(...roles)` (roles from the verified token
only); `requireVerifiedEmail` (403 `EMAIL_NOT_VERIFIED`). Roles are currently
static per session (`['customer']`); a role change requires re-login.

### Mailer

`Mailer` port with a `LoggingMailer` placeholder. It logs the recipient and
template always, and the verification/reset URL **only outside production**. A
real provider slots in behind the same interface later.

### Mobile

- Tokens live only in the platform keystore via `flutter_secure_storage`
  (`SecureTokenStore`): iOS Keychain `first_unlock_this_device` (not synced, not
  restored to a new device); Android AES-GCM + Keystore-wrapped key.
- `AuthenticatedClient` (an `http.BaseClient`) attaches the access token and, on
  a 401, refreshes once (single-flight `TokenRefresher`) and retries. A failed
  refresh clears storage and signals `onSessionExpired`.
- **No backend secret in the app** — only the public API base URL. The app
  authenticates by exchanging the user's password for tokens; it holds no client
  secret, signing key or privileged credential.

### New dependencies

Backend: `@node-rs/argon2`. Mobile: `flutter_secure_storage`, `http`.

## Consequences

- Every authenticated request costs one indexed session lookup — accepted for
  immediate revocation. A short-TTL in-process cache is a possible later
  optimisation.
- The in-memory rate limiter is per-instance; a Redis store is required before
  running more than one backend instance.
- Refresh rotation has no server-side grace window; the mobile client's
  single-flight refresh covers the common case, cross-process races do not.
- Residual gaps are tracked in
  [`../security/authentication-review.md`](../security/authentication-review.md).
