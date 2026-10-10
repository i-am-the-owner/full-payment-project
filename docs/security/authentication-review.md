# Authentication security review (Milestone 5)

Review of the AlmaPay authentication implementation against common authentication
weaknesses (OWASP ASVS V2/V3, OWASP Top 10 A07). Scope: `backend/src/**/auth`,
migration `0009`, and `mobile/lib/core/auth` + `mobile/lib/features/auth`.

Legend: **Addressed** · **Partial** · **Accepted risk** · **Follow-up**

## Credential handling

| Risk                                      | Status        | How                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords stored in plaintext / weak hash | **Addressed** | Argon2id (`@node-rs/argon2`), OWASP params m=19 MiB/t=2/p=1. Column `user_auth.password_hash` only; `password_algorithm` CHECK = `argon2id`. `needsRehash` upgrades on next login.                                                                            |
| Passwords written to logs                 | **Addressed** | Structured logger redacts `password`/`secret`/`token`/… keys. Request bodies are never logged. `validateRequest` field errors contain field paths + messages only, never values. Integration test `no password value is ever written to the structured logs`. |
| Weak passwords accepted                   | **Partial**   | Length-first policy (min 12, max 128), reject single-char and a tiny denylist. **Follow-up:** breached-password check via the HIBP k-anonymity range API.                                                                                                     |
| Password sent to a third party            | **Addressed** | Never leaves the backend process; only the Argon2 hash is persisted.                                                                                                                                                                                          |

## Enumeration & timing

| Risk                                          | Status        | How                                                                                                                                                                   |
| --------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration reveals whether an email exists  | **Addressed** | Always 202 with an identical body. Password is hashed _before_ the existence check (timing). A duplicate address gets an "account exists" email instead of a new row. |
| Login reveals valid emails via status/message | **Addressed** | One generic `401 "Invalid email or password."` for unknown account, wrong password, locked, and suspended.                                                            |
| Login reveals valid emails via timing         | **Addressed** | Every failure path performs an Argon2 `verify` — against a fixed dummy hash when the account is unknown.                                                              |
| `password/forgot` reveals valid emails        | **Addressed** | Always `202` with an identical body; work only happens for an active account.                                                                                         |
| Reset/verify endpoints reveal token validity  | **Addressed** | Generic `400 "…invalid or has expired."` for missing / expired / consumed tokens.                                                                                     |

## Brute force & abuse

| Risk                                                   | Status            | How                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Online password guessing                               | **Addressed**     | Per-account lockout: 5 failures → `locked_until = now()+15min` (atomic `UPDATE`), cleared on success. Plus the per-client `sensitiveRateLimiter` on all `/api/v1/auth/*`. |
| Lockout as a denial-of-service against a known account | **Accepted risk** | Deliberate: a short 15-minute window bounds the impact; the alternative (no lockout) is worse. Revisit with device reputation / CAPTCHA if abused.                        |
| Rate limiter bypass across instances                   | **Follow-up**     | `express-rate-limit` store is in-memory. A shared (Redis) store is required before scaling past one instance.                                                             |
| Reset / verification token guessing                    | **Addressed**     | 256-bit random tokens, stored as SHA-256, single-use, short TTL (60 min / 24 h).                                                                                          |

## Tokens & sessions

| Risk                                               | Status             | How                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT `alg` confusion / `alg:none`                   | **Addressed**      | `jose` with `algorithms:['HS256']`; unit tests cover `alg:none`, wrong secret, wrong issuer.                                                                                                  |
| Long-lived access tokens can't be revoked          | **Addressed**      | 15-min TTL **and** every authenticated request checks the session row is `active` and the account `active`. Logout/reset/suspend are effective immediately.                                   |
| Refresh-token theft / replay                       | **Addressed**      | Opaque, stored hashed, **rotated on every use**. Replaying a rotated/revoked refresh token revokes the entire `family_id` and writes `auth.refresh.reuse_detected`. Unit + integration tests. |
| Session fixation                                   | **Addressed**      | A fresh session (new random refresh token, new `sid`) is created on every login. No session identifier is ever accepted from the client.                                                      |
| CSRF                                               | **Not applicable** | No cookies — bearer tokens in the `Authorization` header only. Documented in ADR 0007.                                                                                                        |
| Logout does not end the session                    | **Addressed**      | `/auth/logout` revokes the session behind the access token and/or a supplied refresh token; `/auth/logout-all` revokes every session for the user.                                            |
| Password change does not invalidate other sessions | **Addressed**      | `password/reset` calls `endAllSessions(user, 'password_reset')` and invalidates other pending reset tokens; a "password changed" email is sent.                                               |
| Individual device/session revocation by the user   | **Follow-up**      | `auth_sessions` records `user_agent`/`ip_address`/`family_id` to support a "your devices" screen; the UI/endpoint is not built yet.                                                           |

## Email verification & account state

| Risk                                       | Status        | How                                                                                                                                                    |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unverified users perform sensitive actions | **Partial**   | `requireVerifiedEmail` middleware exists (403 `EMAIL_NOT_VERIFIED`); it will gate money features. Basic app use is allowed pre-verification by design. |
| Verification status stale in a live token  | **Addressed** | `authenticate` reads `emailVerified` from the database, not the JWT claim (the claim is a client hint only).                                           |
| Suspended/closed accounts keep access      | **Addressed** | `authenticate` rejects any session whose account is not `active`; login also refuses non-active accounts.                                              |

## Transport & secrets

| Risk                                                        | Status               | How                                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Credentials over plain HTTP                                 | **Addressed** (prod) | `requireHttps` rejects non-TLS in production behind a trusted proxy; HSTS on. Dev talks to `http://10.0.2.2:3000` (loopback) only.                                                                           |
| Backend secret shipped in the mobile app                    | **Addressed**        | The app holds only `apiBaseUrl`. It exchanges the user password for tokens; no client secret, signing key, DB credential or Wise credential is present. Enforced by review + `AuthDependencies` doc comment. |
| Verification/reset link (single-use secret) leaked via logs | **Addressed**        | `LoggingMailer` includes the URL only when `NODE_ENV != production`.                                                                                                                                         |

## Mobile token storage

| Risk                                                      | Status            | How                                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens in plaintext prefs / app documents                 | **Addressed**     | `flutter_secure_storage` only. iOS Keychain `first_unlock_this_device` (not iCloud-synced, not migrated to a new device). Android AES-GCM with a Keystore-wrapped key. Namespaced keys. |
| Tokens in logs / crash reports                            | **Addressed**     | `AuthTokens.toString()` returns `<redacted>`; tokens are never passed to `print`/logging. Unit test asserts.                                                                            |
| Refresh storm self-revoking the session on flaky networks | **Partial**       | `TokenRefresher` coalesces concurrent refreshes into one in-flight request (single-flight). Cross-process/cross-device races are not covered (no server grace window).                  |
| Stolen device with an unlocked app                        | **Accepted risk** | Mitigated by the OS lock screen + Keychain accessibility. Biometric-gated storage / app-level re-auth is a follow-up.                                                                   |

## Not yet implemented (tracked)

- MFA / TOTP (schema note in migration `0003`; no code).
- Breached-password check (HIBP).
- Real transactional email delivery (currently `LoggingMailer`).
- Redis-backed rate-limit + session caches for multi-instance deploys.
- User-facing session/device management.
- Deep-link handling in the mobile app for verification/reset URLs.
- Step-up authentication for sensitive (money) operations.
