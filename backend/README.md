# AlmaPay backend

Node.js + TypeScript REST API for AlmaPay.

## Requirements

- Node.js 22 LTS (`nvm use` reads the repo `.nvmrc`)
- npm 10+
- PostgreSQL 14+ (local or Docker – see [`../docs/database/README.md`](../docs/database/README.md))

## Setup

```bash
npm install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm run db:migrate            # apply the schema
npm run dev
```

The API listens on `PORT` (default `3000`). Verify it is up:

```bash
curl http://localhost:3000/healthz
# {"data":{"status":"ok","version":"0.1.0","uptimeSeconds":1},"meta":{...}}
curl http://localhost:3000/readyz     # 200 when the database is reachable
```

`DATABASE_URL` and `JWT_SECRET` are required to start. API surface, response
format and error codes: [`../docs/api/README.md`](../docs/api/README.md).

## Scripts

| Script                     | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `npm run dev`              | Run with watch mode and `.env` loaded.                         |
| `npm run build`            | Type-check and emit JavaScript to `dist/`.                     |
| `npm start`                | Run the compiled server (`dist/main.js`).                      |
| `npm run typecheck`        | `tsc --noEmit`.                                                |
| `npm run lint`             | ESLint (type-aware).                                           |
| `npm run format`           | Prettier (write).                                              |
| `npm run format:check`     | Prettier (verify only).                                        |
| `npm test`                 | Unit then integration tests.                                   |
| `npm run test:unit`        | Unit tests only (no database needed).                          |
| `npm run test:integration` | Integration tests (serial; need `DATABASE_URL`, else skipped). |
| `npm run test:coverage`    | Unit tests with V8 coverage.                                   |
| `npm run db:migrate`       | Apply pending database migrations.                             |
| `npm run db:rollback`      | Revert the most recent migration.                              |
| `npm run db:status`        | Show applied / pending migrations.                             |

## Database

PostgreSQL 14+. Migrations are plain SQL in `migrations/`. See
[`../docs/database/README.md`](../docs/database/README.md) for local setup and
workflow, and [`../docs/database/schema.md`](../docs/database/schema.md) for the
schema. The database integration tests
(`test/integration/database/`) run only when `DATABASE_URL` is set and are
skipped otherwise.

## Architecture

Clean, layered architecture. Dependencies point inwards only.

```
src/
  domain/                 Business types and rules. No I/O, no framework imports.
    auth/                 Principal, roles.
    health/               Service health + readiness types.
    payout/               The provider-neutral vocabulary: the one transfer status
                           enum + state machine, our own payout types, typed errors.
    transfer/             Local quote / recipient (summary) / transfer records.
  application/             Use cases + ports (interfaces). Dependencies injected.
    auth/                 TokenService port, user directory port, get-current-user.
    health/               get-service-health, check-readiness.
    payout/               PayoutProvider (the single provider interface), currency
                           catalogue, customer onboarding.
    transfer/             Send-money use cases: request-quote, add-recipient,
                           confirm-transfer, cancel-transfer, queries,
                           apply-provider-transfer-update, receive-provider-webhook,
                           + repository ports.
  infrastructure/          Concrete adapters.
    auth/                 JwtTokenService (jose, HS256).
    database/              pg pool, migration runner + CLI, readiness check, user directory,
                           transfer/quote/recipient/webhook-event repositories,
                           customer link store, currency registry.
    providers/            EVERYTHING provider-specific lives here and only here.
      create-payout-provider.ts   Selection by PAYOUT_PROVIDER + config validation.
      provider-http-client.ts     Shared HTTP helper (timeouts, safe retries, logs).
      mock/                       Full in-process provider (default).
      wise/                       Wise adapter (config, API client, auth, SCA,
                                   webhooks, status mapping).
      airwallex/                  Airwallex Connected Accounts adapter.
      currencycloud/              Documented stub (throws NotImplemented).
  interfaces/http/          Express layer.
    middleware/            request context, security headers, require-https, authenticate,
                           authorize, validate-request, rate-limit, error handler.
    api/                   Versioned routers: /api, /api/v1 (me, admin, currencies,
                           customer onboarding, quotes, recipients, transfers).
    webhooks/             /webhooks/:provider (raw body, signature-verified).
    dev/                  Dev-only mock-provider controls (never mounted in production).
    response.ts            The success/error envelope.
  config/                 Environment parsing (zod) and typed AppConfig.
  shared/                 Structured logger, error hierarchy, money (decimal ↔ minor units).
  container.ts            Composition root – builds the object graph once at startup.
  main.ts                 Process bootstrap and graceful shutdown.
migrations/              Plain-SQL database migrations (NNNN_name.sql).
```

Development seed data (two customers, three recipients, four transfers, mock
provider only): `npm run db:seed` after `npm run db:migrate`. It refuses to run
in production or with any provider other than `mock`, and is safe to run twice.
Set `SEED_USER_PASSWORD` to give the seed customers a password.

`test/unit/` mirrors `src/`; `test/integration/` exercises the running HTTP app
on an ephemeral port against a real database.

### Configuration

All environment input is declared and validated in `src/config/env.ts`. Invalid
configuration fails fast at startup. Secrets are supplied by the environment /
deployment platform, never committed. `.env` is git-ignored; `.env.example`
documents the available keys.

### Logging

`src/shared/logger.ts` emits structured JSON with built-in redaction of sensitive
keys (passwords, tokens, card and account numbers, …). See
[`../docs/architecture/adr/0004-backend-logging.md`](../docs/architecture/adr/0004-backend-logging.md).

### API foundation

Request pipeline: security headers → HTTPS enforcement (prod) → request
id/logger → health probes → JSON body limit (32 kB) → global rate limit →
`/api` router → 404 → error handler. All responses use one envelope
(`interfaces/http/response.ts`). See
[`../docs/architecture/adr/0007-api-foundation.md`](../docs/architecture/adr/0007-api-foundation.md)
and [`../docs/api/README.md`](../docs/api/README.md).

### Authentication

`/api/v1/auth/*` — registration, login, rotating refresh-token sessions, logout,
email verification, password reset. Passwords: Argon2id (`@node-rs/argon2`).
Access tokens: HS256 JWT with a `sid` claim; `authenticate` verifies the JWT
**and** that the session + account are still active (immediate revocation).
Per-account lockout + per-client rate limiting. No response reveals whether an
email is registered. Design: ADR 0008; security review:
[`../docs/security/authentication-review.md`](../docs/security/authentication-review.md).

Optional two-step sign-in (TOTP, RFC 6238): `POST /auth/2fa/setup|enable|disable`.
The secret is encrypted at rest with `ENCRYPTION_KEY`; a code cannot be reused.

### Sign-up and provider onboarding

Email + password → verified email → profile (`PUT /profile`) → the provider's
identity check (`POST /onboarding/start`, then the provider redirects the
customer to `GET /onboarding/callback`). The verification status is written
only from provider data; a name / date-of-birth mismatch holds the link as
`REJECTED_PENDING_REVIEW` and logs `admin.alert.identity_mismatch`; a rejected
provider token marks the link `NEEDS_RELINK`. Sending needs `VERIFIED`.

Try it with the mock provider (no external accounts):

```bash
PAYOUT_PROVIDER=mock DEV_LOG_MAIL_LINKS=true npm run dev
# 1. POST /api/v1/auth/register, then POST /api/v1/auth/email/verify with the
#    token from the logged link, then POST /api/v1/auth/login.
# 2. PUT /api/v1/profile
# 3. POST /api/v1/onboarding/start  -> { kind: "redirect", url }
# 4. Open the url in a browser: the mock identity page. Choose "Approve".
# 5. GET /api/v1/onboarding/status  -> VERIFIED; POST /api/v1/quotes now works.
```

Mock test emails: `name+mismatch@…` makes the mock report a different date of
birth (exercises the identity check).

### Status updates: webhooks, jobs, polling, notifications

`POST /webhooks/:provider` (raw body, outside `/api`):

1. The signature is verified over the raw bytes **before** anything is parsed. A bad one is a `401`, logged
   (length only, never the body) and stored as an unverified `webhook_events` row.
2. The event is stored once per `(provider, event id)` (the SHA-256 of the signed body when the provider sends no
   id). A repeat is acknowledged with `200` and does nothing.
3. A `process_webhook` job is queued and the provider gets `200` straight away.

A small database-backed job queue (`jobs`, claimed with `FOR UPDATE SKIP LOCKED`, retried with backoff, parked as
`dead` plus an admin alert after the last attempt) runs three kinds of job. The worker starts with the server
(`BACKGROUND_JOBS_ENABLED`, default on); several instances can run at once.

| Job                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process_webhook`      | Applies one stored event. Transfer events go through the single provider-evidence path: statuses only move **forward**; an older or impossible event is not applied but is recorded on `transfer_events` with `applied = false`. Customer (KYC / account) events update `provider_links` the same way, and `VERIFIED` is accepted only after the identity check. An unknown transfer is retried for a while (a webhook can beat our own record), then recorded as failed with an admin alert. |
| `notify_transfer`      | Emails the customer (funds received, sent, delivered, cancelled, refunded, failed) with the amount and recipient name. Sent once per transfer and kind. There is no push: the mobile app has no push channel yet.                                                                                                                                                                                                                                                                             |
| `poll_stuck_transfers` | Every 15 minutes (`STUCK_TRANSFER_POLL_EVERY_MINUTES`): transfers that are not final and have not changed for 30 minutes (`STUCK_TRANSFER_AFTER_MINUTES`) are looked up at the provider and any change is applied with source `POLL`. It also adopts a transfer whose create call never got an answer (lookup by idempotency key; it never creates one).                                                                                                                                      |

A payout that fails after the provider had the customer's money raises an admin alert
(`PAYOUT_FAILED_AFTER_FUNDING`) and the customer is told the provider will return their money. Admins read alerts at
`GET /api/v1/admin/alerts` and close them with `POST /api/v1/admin/alerts/:id/resolve`.

**Testing it (mock provider).**

```bash
MOCK_WEBHOOK_SECRET=dev-only-secret-0123456789 PORT=3999 npm run dev
# send every status, as a provider would (signed, over HTTP):
npm run webhooks:mock -- --transfer mock-transfer-<id> --all
npm run webhooks:mock -- --transfer mock-transfer-<id> --status funded --times 3      # duplicates
npm run webhooks:mock -- --transfer mock-transfer-<id> --status funded --seconds-ago 600  # out of order
npm run webhooks:mock -- --transfer mock-transfer-<id> --status delivered --bad-signature  # 401
```

With `DEV_LOG_MAIL_LINKS=true` the notification text is written to the log. In the app, the dev "test tool" on the
status screen uses `POST /dev/mock/transfers/:id/advance` and `POST /dev/mock/transfers/:id/webhook`.

**Wise.** `npm run webhooks:wise-simulate -- --profile-id <id> --transfer <wise id> --state processing` calls the
Wise Simulation API (sandbox only; the transfer must be funded; 5 seconds between calls) and Wise then sends its real
webhook.

**Registering the URL with the provider.** `WEBHOOK_BASE_URL=https://api.example npm run webhooks:setup`
(`--dry-run` to preview). Wise: creates the `transfers#state-change` and `kyc-reviews#state-change` application
subscriptions (needs `WISE_CLIENT_KEY`; run it once, Wise creates a new subscription each time). Airwallex: webhooks
are created in its web app (the script prints the steps and the events to select). Currencycloud: not implemented.

### Security

The full review is in [`../SECURITY_REVIEW.md`](../SECURITY_REVIEW.md). In short:

- Secrets come only from the environment; nothing has a default; production refuses placeholder or missing
  secrets, a database without TLS and a missing proxy. `node scripts/scan-secrets.ts <paths>` (also run as a test)
  looks for secrets in source and built bundles.
- Every JSON body and query is validated by a strict schema; SQL is parameterised; ownership of every quote,
  recipient and transfer is checked (`test/integration/security/cross-user-access.test.ts`).
- CORS allows no browser origin unless listed in `CORS_ALLOWED_ORIGINS`. The customer is only sent to a provider
  page on `PROVIDER_REDIRECT_HOSTS`.
- Provider refresh tokens are encrypted at rest; access tokens live in memory; mTLS certificates are loaded from
  files named by `PROVIDER_MTLS_*`.
- Admins can suspend a customer (`POST /api/v1/admin/users/:id/suspend`), which blocks them on their next request;
  unusual activity raises admin alerts.
- UK GDPR: `npm run user-data -- export --user <email|id> [--out file]` and
  `npm run user-data -- erase --user <email|id> --confirm <email> [--scrub-audit-ips]`. Erasure keeps transfer
  records (five-year financial record rule) and refuses while any transfer is unfinished.

### Payout providers

The backend talks to one licensed payout provider through a single interface,
`PayoutProvider` (`src/application/payout/payout-provider.ts`). The provider is
chosen by `PAYOUT_PROVIDER`:

| Value            | State                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock` (default) | Complete, in-process, no credentials. Refused in production.                                                                                                                                                                                                                        |
| `wise`           | Full adapter: currencies, quotes, dynamic recipient and transfer forms, transfers, bank-transfer instructions, balance funding, cancel, webhooks. `personal_token` mode tested against mocks (sandbox test is opt-in); `oauth_partner` mode written but untested. See "Wise setup". |
| `airwallex`      | Connected Accounts adapter written from the Airwallex docs with mocked-HTTP tests; not yet run against the sandbox. Hosted onboarding is business accounts only.                                                                                                                    |
| `currencycloud`  | Documented stub: config is validated at startup, every operation throws `NotImplemented`.                                                                                                                                                                                           |

Startup fails with a clear message if the chosen provider's variables are
missing. Nothing outside `src/infrastructure/providers/` contains a provider URL
or imports a provider's code, except the composition root and the dev-only mock
route. Provider comparison and environment variables:
[`../docs/PROVIDERS.md`](../docs/PROVIDERS.md). Status mapping:
[`../docs/STATUSES.md`](../docs/STATUSES.md). Wise
details: [`../docs/integrations/wise.md`](../docs/integrations/wise.md), ADR 0009
and ADR 0011.

### Wise setup

Run with `PAYOUT_PROVIDER=wise`. Sandbox API: `https://api.wise-sandbox.com`. The base URL always comes
from the environment and never defaults to production.

| Variable                                                                     | Needed for           | What it is / how to get it                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WISE_AUTH_MODE`                                                             | all                  | `personal_token` (default, sandbox testing) or `oauth_partner` (untested until partner credentials exist).                                                                                                                 |
| `WISE_API_TOKEN`                                                             | personal_token       | Sandbox personal API token: sign in at the Wise sandbox, Settings > API tokens. It acts for one Wise account, so every customer shares it: testing only, refused on production hosts.                                      |
| `WISE_API_BASE_URL`                                                          | optional             | Default `https://api.wise-sandbox.com`. Production: `https://api.wise.com` (TLS) or `https://api-mtls.transferwise.com` (mTLS); also needs `NODE_ENV=production`, `WISE_ALLOW_PRODUCTION=true`, `WISE_WEBHOOK_PUBLIC_KEY`. |
| `WISE_API_VERSION`                                                           | optional             | Dated path version for newer endpoints, `YYYYQ#`, default `2026Q4`.                                                                                                                                                        |
| `WISE_CLIENT_ID`, `WISE_CLIENT_SECRET`                                       | oauth_partner        | Issued by Wise partner onboarding.                                                                                                                                                                                         |
| `WISE_AUTHORIZE_URL`                                                         | oauth_partner        | https URL of Wise's authorise page, given in partner onboarding (not in the public docs).                                                                                                                                  |
| `WISE_OAUTH_REDIRECT_URI`                                                    | oauth_partner        | Our callback URL, registered with Wise.                                                                                                                                                                                    |
| `WISE_SOURCE_CURRENCIES`                                                     | optional             | Currencies customers pay in; default `GBP`.                                                                                                                                                                                |
| `WISE_WEBHOOK_PUBLIC_KEY`                                                    | production           | Wise's webhook signing key (PEM). The sandbox key is bundled for sandbox hosts.                                                                                                                                            |
| `WISE_SCA_PRIVATE_KEY`                                                       | optional             | PEM RSA private key for signing strong-customer-authentication one-time tokens; its public half is registered with Wise.                                                                                                   |
| `WISE_CLIENT_KEY`                                                            | webhook setup script | Client credentials key used by `scripts/setup-webhooks.ts`.                                                                                                                                                                |
| `PROVIDER_MTLS_CERT_PATH`, `PROVIDER_MTLS_KEY_PATH`, `PROVIDER_MTLS_CA_PATH` | optional             | mTLS client certificate for the mTLS host.                                                                                                                                                                                 |

Notes: in the UK/EU a personal token cannot fund a transfer from balance (PSD2), so the customer is shown
Wise's bank-transfer instructions (reference `T<transfer id>`). Move a funded sandbox transfer through its
states with `node --env-file-if-exists=.env scripts/wise-simulate.ts --profile-id <id> --transfer <id> --state processing`.
Tokens are never logged. The opt-in end-to-end sandbox test runs only when `WISE_API_TOKEN` is set:
`WISE_API_TOKEN=... node --test test/integration/providers/wise-sandbox.test.ts`.

### Send-money flow

Onboarding → `GET /api/v1/currencies` → `POST /api/v1/quotes` →
`POST /api/v1/recipient-form` + `POST /api/v1/recipients` →
`POST /api/v1/quotes/:id/recipient` → `POST /api/v1/transfer-form` +
`POST /api/v1/transfers` (with an `Idempotency-Key`) →
`GET /api/v1/transfers/:id/funding` (how to pay the provider) → status by
provider webhook. Per-customer limits (`TRANSFER_LIMIT_*`) are checked before a
transfer is created. The provider owns every money
figure; the backend stores an immutable copy of the quote, a recipient summary
and the transfer with its status history, so history never calls the provider.
AlmaPay never funds a transfer: it stays `AWAITING_FUNDS` until the customer pays
the provider. Duplicate confirmations return the original transfer. Tested end to
end against the mock provider (`test/integration/send-money/`). With the mock you
can drive a transfer to `COMPLETED` using
`POST /dev/mock/transfers/:id/advance`. See ADR 0010 and ADR 0011.

### TypeScript / runtime

The backend runs TypeScript directly on Node's native type stripping (no `ts-node`
or bundler). This constrains the code to erasable syntax (no `enum`, no
parameter properties); the compiler enforces this via `erasableSyntaxOnly`. See
[`../docs/architecture/adr/0003-backend-runtime-and-tooling.md`](../docs/architecture/adr/0003-backend-runtime-and-tooling.md).
