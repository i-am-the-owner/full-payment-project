# AlmaPay API

Design rationale: [`../architecture/adr/0007-api-foundation.md`](../architecture/adr/0007-api-foundation.md)
(request pipeline) and [`../architecture/adr/0008-authentication.md`](../architecture/adr/0008-authentication.md)
(auth).

> **Status (Milestone 7):** foundation + authentication + the send-money flow.
> Endpoints: health probes, API discovery, `/api/v1/auth/*`, `GET /api/v1/me`, an
> admin diagnostic, and `/api/v1/{quotes,recipients,transfers}` backed by the
> Wise Sandbox integration.

## Base URL and versioning

| Path                  | Versioned | Notes                                            |
| --------------------- | --------- | ------------------------------------------------ |
| `/healthz`, `/readyz` | no        | Infra probes for orchestrators / load balancers. |
| `/api`                | no        | Version discovery.                               |
| `/api/v1/**`          | yes       | The current API.                                 |

Versioning is by URL path (`/api/v{n}`). A new major version is introduced only
for breaking changes; backwards-compatible additions ship within the current
version.

## Response format

Every response is a JSON envelope.

**Success**

```json
{
  "data": { "...": "endpoint-specific payload" },
  "meta": { "requestId": "b1c1...", "timestamp": "2026-09-07T12:00:00.000Z" }
}
```

**Error**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request did not pass validation.",
    "requestId": "b1c1...",
    "timestamp": "2026-09-07T12:00:00.000Z",
    "fieldErrors": [{ "field": "body.email", "message": "Required" }]
  }
}
```

`fieldErrors` is present only for validation problems. Internal details, stack
traces and secrets are never returned; an unexpected failure is a generic
`INTERNAL` 500 correlated by `requestId` to the server logs.

### Error codes

| code                       | HTTP | meaning                                                                                                                                            |
| -------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`         | 400  | Malformed input, failed schema validation, or values the payout provider rejected (`fieldErrors` names the fields).                                |
| `UNAUTHORIZED`             | 401  | Missing, malformed or expired access token; revoked session; inactive account.                                                                     |
| `FORBIDDEN`                | 403  | Authenticated but not allowed (role).                                                                                                              |
| `EMAIL_NOT_VERIFIED`       | 403  | The account's email address is not verified.                                                                                                       |
| `CUSTOMER_NOT_VERIFIED`    | 403  | The payout provider has not verified the customer's identity (KYC). Returned by every endpoint that prices or moves money.                         |
| `NEEDS_RELINK`             | 403  | The customer's connection to the payout provider is no longer valid and must be set up again.                                                      |
| `LIMIT_EXCEEDED`           | 422  | The transfer would break a sending limit. `fieldErrors[0].message` is `PER_TRANSFER`, `PER_DAY` or `PER_MONTH`; `message` says the limit in words. |
| `TOTP_REQUIRED`            | 401  | The password was right; sign-in also needs the 6-digit authenticator code (`totpCode`).                                                            |
| `PROFILE_INCOMPLETE`       | 409  | The profile step must be finished before the identity check can start.                                                                             |
| `COUNTRY_NOT_SUPPORTED`    | 422  | The provider does not accept senders who live in that country.                                                                                     |
| `INVALID_ONBOARDING_STATE` | 400  | The provider's redirect carried no `state`, or one that is unknown, expired or already used.                                                       |
| `TOTP_UNAVAILABLE`         | 503  | Two-step sign-in cannot be set up because no encryption key is configured.                                                                         |
| `SCA_REQUIRED`             | 403  | The provider needs additional customer authentication.                                                                                             |
| `QUOTE_EXPIRED`            | 409  | The quote is past its expiry or can no longer be used. Request a new one.                                                                          |
| `CONFLICT`                 | 409  | The request conflicts with the current state (e.g. cancelling a funded transfer, a duplicate).                                                     |
| `INSUFFICIENT_FUNDS`       | 409  | The provider balance cannot cover the transfer.                                                                                                    |
| `ROUTE_NOT_SUPPORTED`      | 422  | The provider does not send between those currencies / to that country.                                                                             |
| `PROVIDER_REJECTED`        | 422  | The provider refused the request for a reason that is not about field values.                                                                      |
| `NOT_IMPLEMENTED`          | 501  | The selected payout provider does not implement this operation yet.                                                                                |
| `NOT_FOUND`                | 404  | No such route or resource.                                                                                                                         |
| `PAYLOAD_TOO_LARGE`        | 413  | Request body exceeds the limit (32 kB).                                                                                                            |
| `RATE_LIMITED`             | 429  | Too many requests; see `Retry-After`.                                                                                                              |
| `SERVICE_UNAVAILABLE`      | 503  | A dependency is down (see `/readyz`), or the payout provider is unavailable.                                                                       |
| `INTERNAL`                 | 500  | Unexpected server error.                                                                                                                           |

## Correlation

Send `X-Request-Id` to correlate a call with your own logs; if absent the server
generates one. It is always returned as `X-Request-Id` and in `meta.requestId` /
`error.requestId`.

## Authentication

Send an access token as `Authorization: Bearer <jwt>`. Access tokens are
short-lived HS256 JWTs (`iss=almapay`, `aud=almapay-mobile`, `sub=<userId>`,
`sid`, `roles`, `jti`); when one expires, `POST /api/v1/auth/refresh` exchanges
the (single-use, rotating) refresh token for a new pair. Logout, password reset
and account suspension revoke the session immediately — the next request with
that access token returns `401`. See
[`../architecture/adr/0008-authentication.md`](../architecture/adr/0008-authentication.md).

## Security headers

Responses set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'`, `Cache-Control: no-store`, and HSTS in production. There
are no CORS headers — the API is for the mobile client, not browsers.

## Endpoints

| Method & path                                 | Auth                                                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz`                                | none                                                                     | Liveness. Always 200 when reachable.                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /readyz`                                 | none                                                                     | Readiness. 200 when dependencies are up, else 503.                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api`                                    | none                                                                     | Lists API versions.                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/v1/auth/register`                  | none                                                                     | Create an account. Always `202`; a verification email is sent.                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/v1/auth/login`                     | none                                                                     | `{ email, password, totpCode? }` → `{ accessToken, refreshToken, expiresIn, user }`. With two-step sign-in on and no `totpCode`: `401 TOTP_REQUIRED` (only after a correct password). A wrong code counts as a failed login.                                                                                                                                                                                 |
| `POST /api/v1/auth/refresh`                   | none                                                                     | `{ refreshToken }` → a rotated token pair. Old refresh token is invalidated.                                                                                                                                                                                                                                                                                                                                 |
| `POST /api/v1/auth/logout`                    | optional bearer                                                          | `{ refreshToken? }`. Revokes the session(s). Always `200`.                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/v1/auth/logout-all`                | bearer                                                                   | Revokes every session for the user.                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/v1/auth/email/verify`              | none                                                                     | `{ token }` from the verification email.                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/auth/email/resend`              | bearer                                                                   | Re-send the verification email.                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/auth/password/forgot`           | none                                                                     | `{ email }`. Always `202`.                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/v1/auth/password/reset`            | none                                                                     | `{ token, newPassword }`. Revokes all sessions.                                                                                                                                                                                                                                                                                                                                                              |
| `GET /api/v1/me`                              | bearer                                                                   | The authenticated user's own account.                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/v1/admin/whoami`                    | bearer + `admin` + 2FA                                                   | Principal diagnostics (exercises authorization).                                                                                                                                                                                                                                                                                                                                                             |
| `POST /api/v1/auth/2fa/setup`                 | bearer                                                                   | `{ password }` (asked again: a stolen token alone is not enough). Starts optional two-step sign-in: `{ secret, otpauthUri }` to add to an authenticator app. Not on until enabled. `503 TOTP_UNAVAILABLE` if `ENCRYPTION_KEY` is not configured.                                                                                                                                                             |
| `POST /api/v1/auth/2fa/enable`                | bearer                                                                   | `{ code }` (6 digits) proves the app works and turns two-step sign-in on.                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/v1/auth/2fa/disable`               | bearer                                                                   | `{ code, password }` turns it off.                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/v1/profile`                         | bearer                                                                   | `{ profile, complete, supportedCountries }`. `supportedCountries` are the countries the provider accepts senders from (from the provider's capabilities, else `SENDER_COUNTRIES`).                                                                                                                                                                                                                           |
| `PUT /api/v1/profile`                         | bearer + verified email                                                  | `{ firstName, lastName, dateOfBirth (YYYY-MM-DD), countryOfResidence (ISO alpha-2), phone (E.164) }`. Strict: any other field is a `400`. `422 COUNTRY_NOT_SUPPORTED` if the provider does not accept senders from that country.                                                                                                                                                                             |
| `GET /api/v1/onboarding/status`               | bearer                                                                   | `{ status, emailVerified, profileComplete }`. Asks the provider for the customer's verification status and stores it: `UNVERIFIED`, `PENDING`, `VERIFIED`, `REJECTED`, `REJECTED_PENDING_REVIEW` or `NEEDS_RELINK`.                                                                                                                                                                                          |
| `POST /api/v1/onboarding/start`               | bearer + verified email                                                  | Starts (or, after `NEEDS_RELINK`, restarts) the provider's identity check. Empty body only. `{ kind: "redirect", url }` – open `url` in a browser or web view – or `{ kind: "done", status }`. The URL is checked first: `https`, no credentials, on a host in `PROVIDER_REDIRECT_HOSTS`. Stores a `PENDING` link. `409 PROFILE_INCOMPLETE` before the profile step is done.                                 |
| `GET /api/v1/onboarding/callback`             | single-use `state`                                                       | Where the provider sends the customer's browser afterwards. **Not called by the app.** Validates the `state` we generated in `start` (random, stored hashed, 30 minutes, single use), then completes onboarding from the provider's data. Returns a small HTML page and never redirects. `400` for a missing, unknown, expired or reused state.                                                              |
| `GET /api/v1/currencies`                      | bearer + verified email + provider-verified                              | What the payout provider supports right now (cached): `{ sourceCurrencies, targetCurrencies, currencies[{ code, name, minorUnit }], provider{ name, displayName }, payoutCountries, features }`. Never hard-coded.                                                                                                                                                                                           |
| `POST /api/v1/quotes`                         | bearer + verified email + provider-verified                              | `{ sourceCurrency, targetCurrency, sourceAmount \| targetAmount }` (amounts are decimal **strings**) → the provider's quote, saved: `{ id, source, fee, totalToPay, target, exchangeRate, estimatedDelivery, expiresAt }`. `totalToPay = source + fee`.                                                                                                                                                      |
| `POST /api/v1/quotes/:id/recipient`           | bearer + verified email + provider-verified                              | `{ recipientId }` → the quote priced for that recipient, plus `priceChanged`. If the price changed, the response is a **new** quote (new `id`); confirm with that one.                                                                                                                                                                                                                                       |
| `GET /api/v1/recipients`                      | bearer + verified email + provider-verified                              | The user's saved recipients (summary only: name, country, currency, masked `accountSummary`).                                                                                                                                                                                                                                                                                                                |
| `POST /api/v1/recipient-form`                 | bearer + verified email + provider-verified                              | `{ currency, country, quoteId?, partialValues? }` → the provider's recipient form: `{ groups, fields[{ key, label, type (text\|select\|radio\|date), required, group, validation{ pattern, minLength, maxLength }, options?, refreshOnChange, example? }] }`. Re-request with `partialValues` when a `refreshOnChange` field changes.                                                                        |
| `POST /api/v1/recipients`                     | bearer + verified email + provider-verified                              | `{ currency, country, values, displayName? }`. The provider validates and keeps the bank details; AlmaPay stores and returns a summary only.                                                                                                                                                                                                                                                                 |
| `DELETE /api/v1/recipients/:id`               | bearer + verified email + provider-verified                              | Soft delete: no longer listed or usable; past transfers keep the summary.                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/v1/transfer-form`                  | bearer + verified email + provider-verified                              | `{ quoteId, recipientId }` → the provider's extra questions for the transfer (e.g. purpose), as a form.                                                                                                                                                                                                                                                                                                      |
| `POST /api/v1/transfers`                      | bearer + verified email + provider-verified + `Idempotency-Key` (a UUID) | `{ quoteId, recipientId, answers, reference? }`. Checks the quote is the caller's and unexpired and the sending limits, writes AlmaPay's transfer row as `DRAFT` first, then creates the transfer at the provider using that row's UUID as the idempotency key. `201` fresh, `200` for a replay or for a quote that was already used. Left `AWAITING_FUNDS`. `422 LIMIT_EXCEEDED` over a limit.              |
| `GET /api/v1/transfers/:id/funding`           | bearer + verified email + provider-verified                              | How to pay the provider: `{ provider{ name, displayName }, methods[{ method: BANK_TRANSFER, amount, bankDetails[{ label, value }], reference } \| { method: BALANCE, amount }] }`. The bank details are the provider's, fetched live, never stored. `Cache-Control: no-store`. `409` unless `AWAITING_FUNDS`.                                                                                                |
| `POST /api/v1/transfers/:id/fund`             | bearer + verified email + provider-verified                              | `{ method: BANK_TRANSFER \| BALANCE }` → `{ outcome, message, transfer }`. `outcome` is `FUNDED` (provider took it from the customer's own balance), `AWAITING_PAYMENT` (customer pays by bank transfer), `SCA_REQUIRED` (show `message`: the customer must approve with the provider) or `REJECTED`. `409 INSUFFICIENT_FUNDS` if the balance is too low.                                                    |
| `GET /api/v1/transfers`                       | bearer + verified email                                                  | `?page=1&pageSize=20` (max 50) → `{ transfers, page, pageSize, hasMore }`, newest first, from AlmaPay's own database only.                                                                                                                                                                                                                                                                                   |
| `GET /api/v1/transfers/:id`                   | bearer + verified email                                                  | One transfer with `recipient` (summary) and `timeline[{ status, occurredAt }]`, from AlmaPay's own database. Does not call the provider.                                                                                                                                                                                                                                                                     |
| `POST /api/v1/transfers/:id/refresh`          | bearer + verified email                                                  | Looks the transfer up at the provider now and applies its status. Empty body.                                                                                                                                                                                                                                                                                                                                |
| `POST /api/v1/transfers/:id/cancel`           | bearer + verified email                                                  | Cancel a transfer still in `DRAFT` / `AWAITING_FUNDS` (before funds are received). `409` otherwise.                                                                                                                                                                                                                                                                                                          |
| `POST /api/v1/admin/users/:id/suspend`        | bearer + `admin`                                                         | `{ reason }` (3–200 characters). Suspends the account: it takes effect on the user's very next request (every request re-checks the account), all their sessions are revoked and they cannot sign in. Audited. Not allowed on your own account; `409` for a closed account.                                                                                                                                  |
| `POST /api/v1/admin/users/:id/reinstate`      | bearer + `admin`                                                         | Lifts a suspension (old sessions stay revoked). `409` for a closed account.                                                                                                                                                                                                                                                                                                                                  |
| `GET /api/v1/admin/users`                     | bearer + `admin` + 2FA                                                   | `?q=&limit=&offset=` search by email, name or user id (wildcards are literal).                                                                                                                                                                                                                                                                                                                               |
| `GET /api/v1/admin/users/:id`                 | bearer + `admin` + 2FA                                                   | Profile (no date of birth, phone or address), status, 2FA flag, provider links with KYC status, transfer count, recent account events.                                                                                                                                                                                                                                                                       |
| `POST /api/v1/admin/users/:id/unsuspend`      | bearer + `admin` + 2FA                                                   | Same as `reinstate`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/v1/admin/transfers`                 | bearer + `admin` + 2FA                                                   | `?id=` (UUID, reference or provider id) `&userId=&status=&from=&to=&limit=&offset=`.                                                                                                                                                                                                                                                                                                                         |
| `GET /api/v1/admin/transfers/:id`             | bearer + `admin` + 2FA                                                   | Full detail, status timeline and webhook history (type, signature, result; never the body). Read-only.                                                                                                                                                                                                                                                                                                       |
| `GET /api/v1/admin/reports/stuck-transfers`   | bearer + `admin` + 2FA                                                   | `?olderThanHours=24&includeDrafts=false`: not final and unchanged for that long.                                                                                                                                                                                                                                                                                                                             |
| `GET /api/v1/admin/reports/failed-transfers`  | bearer + `admin` + 2FA                                                   | `FAILED` and `REFUNDED` (a bounce-back ends in one of them).                                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/v1/admin/reports/webhook-errors`    | bearer + `admin` + 2FA                                                   | Bad signatures and events that failed to process.                                                                                                                                                                                                                                                                                                                                                            |
| `GET /api/v1/admin/reports/identity-reviews`  | bearer + `admin` + 2FA                                                   | Customers the provider verified whose details do not match ours.                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/v1/admin/dashboard`                 | bearer + `admin` + 2FA                                                   | `?period=day\|month&days=31` transfers, completed and volume per period and currency, with an approximate USD figure (from `DASHBOARD_USD_RATES`) and this month against `MONTHLY_VOLUME_TARGET_USD`.                                                                                                                                                                                                        |
| `GET /api/v1/availability`                    | bearer                                                                   | `{ newTransfersPaused, message }`: whether an admin has paused NEW transfers. While paused, `POST /quotes` and a new `POST /transfers` return `503 TRANSFERS_PAUSED` with the message to show; reading, replaying an existing transfer, funding, cancelling and history all keep working.                                                                                                                    |
| `GET /api/v1/admin/settings`                  | bearer + `admin` + 2FA                                                   | The configured limits and the pause state.                                                                                                                                                                                                                                                                                                                                                                   |
| `PUT /api/v1/admin/settings/transfers-paused` | bearer + `admin` + 2FA                                                   | `{ paused, message?, code }`: `code` is the admin's CURRENT authenticator code (a second check on top of the session; it cannot be reused). Writes `admin.transfers.paused` or `admin.transfers.resumed` to the audit log.                                                                                                                                                                                   |
| `POST /api/v1/auth/2fa/recovery-codes`        | bearer                                                                   | `{ password, code }` → `{ recoveryCodes }`: ten new one-time codes (the old ones stop working), shown once. `POST /auth/2fa/enable` now also returns `recoveryCodes` the first time.                                                                                                                                                                                                                         |
| `GET /api/v1/admin/alerts`                    | bearer + `admin`                                                         | `?status=open\|resolved\|all&limit=50` → things that need a person: `PAYOUT_FAILED_AFTER_FUNDING`, `TRANSFER_REFUNDED`, `UNKNOWN_PROVIDER_TRANSFER`, `UNKNOWN_PROVIDER_CUSTOMER`, `TRANSFER_NOT_CONFIRMED`, `IDENTITY_MISMATCH`, `JOB_FAILED`. Identifiers and statuses only; no personal data.                                                                                                              |
| `POST /api/v1/admin/alerts/:id/resolve`       | bearer + `admin`                                                         | Closes an open alert. `404` if it is not open.                                                                                                                                                                                                                                                                                                                                                               |
| `POST /webhooks/:provider`                    | provider signature                                                       | Inbound notifications from the active provider (`mock`, `wise`, …). The signature is checked over the raw body first (`401` on failure, recorded without the body). A valid event is stored once per event id and queued; the response is `200 { status: received \| duplicate \| ignored }` straight away and a background job applies it. `404` for a provider that is not active. Mounted outside `/api`. |
| `GET /dev/mock/kyc`                           | none                                                                     | **Dev only** – the mock provider's stand-in identity page. Offers "approve / leave pending / reject" links back to our callback; refuses any `return_url` that is not this backend's own callback.                                                                                                                                                                                                           |
| `POST /dev/mock/transfers/:id/webhook`        | bearer                                                                   | **Dev only.** `{ status: <any mock status>, secondsAgo?, times? }` sends the caller's own transfer a signed mock webhook (late with `secondsAgo`, repeated with `times`) through the normal receive/process path.                                                                                                                                                                                            |
| `POST /dev/mock/transfers/:id/advance`        | bearer                                                                   | **Dev only** – exists only with `PAYOUT_PROVIDER=mock` outside production. `{ status? }` moves the caller's own transfer to its next mock status (or the one given) by delivering a signed mock webhook.                                                                                                                                                                                                     |

All `/api/v1/auth/*` endpoints are rate limited per client. Login is
additionally protected by per-account lockout (5 failures → 15 minutes).
Registration, `password/forgot` and all failure paths return responses that do
not reveal whether an email address is registered.

### Send-money flow

The backend talks to exactly one payout provider, chosen by `PAYOUT_PROVIDER`
(`mock` by default), through a single provider-neutral interface. The client
never calls a provider and never sends or recomputes a fee, rate or status.

1. Sign-up and onboarding (below) — the provider verifies the customer. Until
   it reports `VERIFIED`, every money endpoint returns `403 CUSTOMER_NOT_VERIFIED`
   (or `403 NEEDS_RELINK`).
2. `GET /currencies` — what can be sent and received.
3. `POST /quotes` — an immutable, expiring quote with the provider's figures,
   from the amount sent **or** the amount received.
4. `POST /recipient-form`, then `POST /recipients` — the provider's own form
   for that currency and country, then the recipient (summary stored). Or pick
   one from `GET /recipients`.
5. `POST /quotes/:id/recipient` — the provider prices the quote for that
   recipient. Use the quote this returns.
6. `POST /transfer-form`, then `POST /transfers` with `answers` and an
   `Idempotency-Key` header holding a UUID the client creates once and reuses on
   every retry. Duplicate confirmations return the original transfer and
   never create a second one.
7. `GET /transfers/:id/funding` — the customer pays the provider directly (bank
   transfer with the provider's reference, or `POST /transfers/:id/fund` with
   `BALANCE` to pay from their own balance at the provider).
8. Status arrives by signed webhook. `GET /transfers/:id` reads AlmaPay's copy
   with its timeline; `POST /transfers/:id/refresh` asks the provider.

**Exactly one provider transfer.** AlmaPay's row is written first (`DRAFT`) and
its UUID is the provider idempotency key. If the provider's answer is lost
(timeout, network error) the transfer stays `DRAFT`; on the next attempt the
provider is first asked for a transfer with that key
(`findTransferByIdempotencyKey`). If one exists it is adopted; if not, the
create is sent again with the same key; if the lookup fails, nothing is sent.

**Limits.** `TRANSFER_LIMIT_PER_TRANSFER`, `_PER_DAY` (rolling 24 hours) and
`_PER_MONTH` (rolling 30 days), in `TRANSFER_LIMIT_CURRENCY`, counted on
everything the customer pays (fee included). Cancelled, failed and refunded
transfers do not count.

### Sign-up and onboarding flow

1. `POST /auth/register`, then the customer confirms their email
   (`POST /auth/email/verify`) and signs in.
2. `PUT /profile` — name, date of birth, country of residence, phone.
3. `POST /onboarding/start` — returns the provider's page. The client opens it;
   it never talks to the provider's API itself.
4. The provider sends the customer's browser to `GET /onboarding/callback`. The
   backend checks the `state`, asks the provider for the result, stores the
   provider's customer id (and its refresh token, encrypted) and the status.
5. The client polls `GET /onboarding/status` and shows the matching screen.

Rules the backend enforces:

- **The verification status comes only from the provider.** No endpoint accepts
  it; request bodies are strict, so an extra `status` / `kycStatus` field is a
  `400`. AlmaPay can withhold `VERIFIED` but can never grant it.
- **Identity match.** When the provider returns the verified name and date of
  birth, they are compared with the profile. On a mismatch the link becomes
  `REJECTED_PENDING_REVIEW`, an `admin.alert.identity_mismatch` error is logged
  and a `customer.identity_mismatch` audit event is written (field names only,
  never values). Nothing the customer or the provider does afterwards clears
  it; a person must.
- **`NEEDS_RELINK`.** If any provider call fails because the customer's
  connection or tokens are no longer accepted, the link is marked
  `NEEDS_RELINK` and every money endpoint returns `403 NEEDS_RELINK` until the
  customer goes through `POST /onboarding/start` again.

Transfer status is one of `DRAFT`, `AWAITING_FUNDS`, `PROCESSING`, `SENT`,
`COMPLETED`, `CANCELLED`, `REFUNDED`, `FAILED`. The mapping from each provider's
statuses, the allowed transitions and who may make them are in
[`../STATUSES.md`](../STATUSES.md).

### `GET /api/v1/me`

```json
{
  "data": {
    "id": "e6a1…",
    "email": "user@example.test",
    "status": "active",
    "emailVerified": false,
    "roles": ["customer"]
  },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

`401` if the token is missing/invalid or the account no longer exists; `403` if
the account is suspended or closed.

### Admin console rules

Every `/api/v1/admin/*` request needs a valid session **and**, checked in the database on every request, the
`admin` role (table `user_roles`, granted with `scripts/grant-admin.ts`) **and** two-step sign-in turned on
(`403 ADMIN_2FA_REQUIRED` otherwise). The role only enters a session at a sign-in that passed a two-step code.
Before any admin request runs, an `admin.view` or `admin.action` row is written to the audit log (`audit_events`),
and if that write fails the request fails: the search text is never recorded, only its length. There is **no**
endpoint that changes a transfer, an amount, a recipient or a status; the only writes are suspend/unsuspend and
resolving an alert. The page itself is served at `/admin-console/` (switch off with `ADMIN_CONSOLE_ENABLED=false`).

Sign-in with two-step accepts `recoveryCode` (one of the ten codes, any case, dashes optional) instead of `totpCode`.
Each code works once; using one is audited (`auth.two_factor.recovery_code_used`).
The dashboard (`GET /admin/dashboard`) also returns `limits` and `transfersPaused`.
