# Wise Platform integration (Sandbox)

> **Updated 2026-10-03 — provider-neutral layer.** Wise is now one of several
> providers behind the `PayoutProvider` interface and is selected with
> `PAYOUT_PROVIDER=wise` (the old `WISE_ENABLED` and `WISE_PROFILE_ID` variables
> are gone). All Wise code lives in `backend/src/infrastructure/providers/wise/`;
> the webhook endpoint is `POST /webhooks/wise` only while Wise is the active
> provider. Every Wise call is made for the customer's own Wise profile (their
> provider link), never a shared AaminPay business profile, and transfers are not
> funded from an AaminPay balance unless `ALMAPAY_BALANCE_FUNDING_ENABLED=true`.
> Customer onboarding, the currency list, dynamic recipient/transfer forms and
> pay-in instructions are **not implemented** for Wise yet, so Wise cannot be
> used end to end. Sections below that describe file paths, `WiseGateway` as an
> application port, or AaminPay-balance funding predate this change. Status
> mapping: [`../STATUSES.md`](../STATUSES.md).

Milestone 6. The backend integration with the Wise Platform API, behind an
abstraction (`WiseGateway`) so the rest of AaminPay never touches raw Wise calls.

> **Sandbox only.** A production Wise host is refused at startup unless
> `WISE_ALLOW_PRODUCTION=true` is explicitly set. No real customer money.
> Credentials come from Wise partner onboarding via the environment / secrets
> manager — **never** committed, **never** in the Flutter app.
>
> **Status:** the client, auth, webhook verification, error mapping, retry and
> audit logging are implemented and tested with mocked HTTP + fixtures. The
> AaminPay send-money flow that _uses_ this — quotes, recipients, transfer
> records and webhook-to-record reconciliation — landed in Milestone 7
> ([ADR 0010](../architecture/adr/0010-send-money-flow.md),
> [API reference](../api/README.md#send-money-flow)).

Source references: the official Wise Platform docs — [API environments](https://docs.wise.com/guides/developer/environments),
[Security & access](https://docs.wise.com/guides/developer/auth-and-security),
[Client credentials token](https://docs.wise.com/api-reference/client-credentials-token),
[Quotes](https://docs.wise.com/api-reference/quote),
[Recipients](https://docs.wise.com/api-docs/api-reference/transfer),
[Enterprise send-money](https://docs.wise.com/guides/product/send-money/use-cases/enterprise/send-money),
[One-time token / SCA](https://docs.wise.com/guides/developer/auth-and-security/one-time-token),
webhook signature verification (Wise "Webhook events") and the
[digital-signatures examples](https://github.com/transferwise/digital-signatures-examples).

## Endpoints used

| Operation                     | Method & path                                                   | Notes                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token                  | `POST /oauth/token`                                             | HTTP Basic (`client_id:client_secret`), form body `grant_type=client_credentials`. Response `{access_token, token_type:"bearer", expires_in, scope}` (~12 h). Cached until 60 s before expiry. |
| Create quote                  | `POST /v3/profiles/{profileId}/quotes`                          | Body `{sourceCurrency, targetCurrency, sourceAmount                                                                                                                                            | targetAmount, payOut?, targetAccount?}`. |
| Get quote                     | `GET /v3/profiles/{profileId}/quotes/{quoteId}`                 |                                                                                                                                                                                                |
| Create recipient              | `POST /v1/accounts`                                             | GBP → `type:"sort_code"` (`details.legalType/sortCode/accountNumber`); other → `type:"iban"`.                                                                                                  |
| Get recipient                 | `GET /v1/accounts/{id}`                                         |                                                                                                                                                                                                |
| Create transfer               | `POST /v1/transfers`                                            | Body `{targetAccount, quoteUuid, customerTransactionId, details.reference}`.                                                                                                                   |
| Get transfer                  | `GET /v1/transfers/{id}`                                        |                                                                                                                                                                                                |
| Cancel transfer               | `PUT /v1/transfers/{id}/cancel`                                 | Only before funding.                                                                                                                                                                           |
| Fund transfer                 | `POST /v3/profiles/{profileId}/transfers/{transferId}/payments` | Body `{type:"BALANCE"}`. **SCA-protected.**                                                                                                                                                    |
| Simulate state (sandbox only) | `GET /v1/simulation/transfers/{id}/{state}`                     | Drives `incoming_payment_waiting → processing → funds_converted → outgoing_payment_sent`, plus `bounced_back`, `funds_refunded`. Refused outside the sandbox.                                  |
| Webhook subscription          | `POST /v3/applications/{clientKey}/subscriptions`               | `trigger_on:"transfers#state-change"`, `delivery.version:"2.0.0"`, `delivery.url`. (Registered out of band; not created on boot.)                                                              |

## Authentication & secure token handling

- `POST /oauth/token` client-credentials, or a pre-issued `WISE_API_TOKEN` from
  onboarding. The token is held in memory only, refreshed proactively, and never
  logged. On a `401` the client discards the cached token and retries once.
- **SCA** (`fundTransferFromBalance`): an SCA-protected call returns `403` with an
  `x-2fa-approval` one-time token. The client signs that token with AaminPay's RSA
  private key (`RSA-SHA256`, PKCS#1 v1.5, base64) and retries once with
  `x-2fa-approval: <token>` + `X-Signature: <sig>`. If no signing key is
  configured, a clear `wise_sca_required` error is raised instead of failing
  opaquely. The private key comes from `WISE_SCA_PRIVATE_KEY`; its public half is
  registered with Wise at onboarding.

## Money

Wise returns decimal amounts (`129.24`). They are converted to `bigint` minor
units with string arithmetic (`src/shared/money.ts`) — never `parseFloat`.
Exchange rates are kept as exact decimal strings.

## Transfer states

The `WiseTransfer.status` field carries the Wise states **verbatim**:
`incoming_payment_waiting`, `incoming_payment_initiated`, `processing`,
`funds_converted`, `outgoing_payment_sent`, `charged_back`, `cancelled`,
`funds_refunded`, `bounced_back`. An unrecognised value maps to `unknown` (a
defensive fallback for a future Wise state; never used on the happy path).

AaminPay maps these to its own states in
`src/domain/transfer/transfer-status.ts` (Milestone 7):

| Wise state                                                    | AaminPay state                   |
| ------------------------------------------------------------- | ------------------------------- |
| `incoming_payment_waiting`                                    | `awaiting_payment`              |
| `incoming_payment_initiated`, `processing`, `funds_converted` | `processing`                    |
| `outgoing_payment_sent`                                       | `completed`                     |
| `bounced_back`, `charged_back`                                | `failed`                        |
| `cancelled`                                                   | `cancelled`                     |
| `funds_refunded`                                              | `refunded`                      |
| `unknown`                                                     | _(no meaning — update ignored)_ |

Reconciliation is forward-only: a webhook or poll that would move a transfer
backwards is logged and ignored.

## Idempotency

- **Transfer creation** carries `customerTransactionId` (a UUID AaminPay
  supplies). Wise dedupes on it: a repeated request with the same value returns
  the original transfer, never a second one. The HTTP client therefore treats
  `POST /v1/transfers` as retryable.
- Quote creation has no money side effect and is retryable.
- Funding and cancellation are **not** retried by the client; funding an
  already-funded transfer is rejected by Wise, so there is no duplicate-transfer
  risk.
- Webhook deliveries carry `X-Delivery-Id`; AaminPay's webhook processing dedupes
  on it (`webhook_events`, unique on `(provider, dedupe_key)`), falling back to a
  payload hash when the header is absent.
- The AaminPay send-money flow adds two more layers on top of Wise's dedup: a fast
  lookup by `(user_id, idempotency_key)` and a unique constraint that catches a
  concurrent race — see [ADR 0010](../architecture/adr/0010-send-money-flow.md).

## Error mapping

Every failure becomes a `WiseError` (`src/domain/wise/wise-errors.ts`) — the rest
of the codebase never sees a raw HTTP status or Wise body.

| Wise response                    | `WiseError.code`                             |                    Retryable                     |
| -------------------------------- | -------------------------------------------- | :----------------------------------------------: |
| 400 / 422 `{errors:[…]}`         | `wise_validation` (with field `details`)     |                        no                        |
| 401 `{error, error_description}` | `wise_auth`                                  | no (client refreshes token + retries once first) |
| 403 + `x-2fa-approval`           | `wise_sca_required` (`WiseScaRequiredError`) |                        no                        |
| 403 (other)                      | `wise_forbidden`                             |                        no                        |
| 404                              | `wise_not_found`                             |                        no                        |
| 409                              | `wise_conflict`                              |                        no                        |
| 429                              | `wise_rate_limited`                          |           yes (respects `Retry-After`)           |
| 5xx / network error              | `wise_unavailable`                           |                       yes                        |
| timeout                          | `wise_timeout` (`WiseTimeoutError`)          |                       yes                        |

## Retry & timeout

- Timeout: `WISE_HTTP_TIMEOUT_MS` (default 15 s) via `AbortController`.
- Retry: `WISE_HTTP_MAX_RETRIES` (default 3) for **GET and explicitly-idempotent
  POST** only, on `429` and `5xx` and network/timeout errors. Exponential backoff
  with jitter, capped at 2 s; `Retry-After` honoured on `429`.

## Webhooks

`POST /webhooks/wise` (unversioned, outside `/api`, before the JSON body parser).

1. **Signature.** `X-Signature-SHA256` header = base64 `RSA-SHA256` of the raw
   request body, verified against Wise's public key
   (`WISE_WEBHOOK_PUBLIC_KEY`, default = the bundled Wise sandbox key — a public
   value). A bad or missing signature → `401`.
2. **Parse** the verified `transfers#state-change` body into a domain event
   (`transferId`, `currentStatus`, `previousStatus`, `occurredAt`, `deliveryId`,
   `isTest`). An unrecognised event type → `200` (acknowledge so Wise stops
   retrying).
3. **Audit** `wise.webhook.received` (no sensitive data), then hand off to the
   domain handler (wired in Milestone 7). Test notifications (`X-Test-Notification:
true`) are acknowledged but not applied.
4. Respond `2xx` well within Wise's 5-second window. Wise retries a non-2xx up to
   25 times over two weeks.

## Audit logging (no sensitive data)

- The HTTP client logs `method`, `path` (Wise resource ids only), `status`,
  attempt, duration. **Never** the `Authorization` header, request body, or
  response body.
- `AuditLog` entries (`audit_events`) for money operations: `wise.transfer.created`
  / `.funded` / `.cancelled` and `wise.webhook.received`, carrying Wise ids,
  the idempotency key, statuses and amounts (currency + minor units) — **never**
  account numbers, sort codes, IBANs, holder names or tokens. A unit test
  asserts a full quote→recipient→transfer→fund sequence leaks none of these.

## Configuration

All backend-only (`.env` / secrets manager). See `backend/.env.example`.

| Var                                             | Purpose                                                     |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `WISE_ENABLED`                                  | Master switch (default `false`; the app runs without Wise). |
| `WISE_API_BASE_URL`                             | Default `https://api.sandbox.transferwise.tech`.            |
| `WISE_ALLOW_PRODUCTION`                         | Must be `true` to use a production host.                    |
| `WISE_PROFILE_ID`                               | AaminPay's Wise business profile id.                         |
| `WISE_CLIENT_ID` / `WISE_CLIENT_SECRET`         | OAuth client credentials, **or**                            |
| `WISE_API_TOKEN`                                | a pre-issued bearer token.                                  |
| `WISE_WEBHOOK_PUBLIC_KEY`                       | PEM; overrides the bundled sandbox key.                     |
| `WISE_SCA_PRIVATE_KEY`                          | PEM; RSA private key for SCA signing.                       |
| `WISE_HTTP_TIMEOUT_MS`, `WISE_HTTP_MAX_RETRIES` | HTTP tuning.                                                |

## Assumptions to confirm against the onboarding pack

- The exact token type Wise issues AaminPay for money operations (client-credentials
  access token vs. a partner user token) — the code supports both via config.
- The `scope` string and whether an authenticated-quote scope differs from the
  application scope.
- Whether SCA applies to the sandbox test profile (the flow is implemented either
  way).
- Kenya (KES) recipient `type` and `details` fields — discovered at runtime via
  the Wise account-requirements endpoint in Milestone 7 rather than hard-coded.
