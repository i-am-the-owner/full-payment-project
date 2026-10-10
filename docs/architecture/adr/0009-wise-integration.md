# 9. Wise Platform integration behind a gateway abstraction

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

Milestone 6 adds the backend integration with the Wise Platform API (Sandbox):
authentication, quotes, recipients, transfers, funding, transfer status,
inbound webhooks, error mapping, retry, timeout and audit logging. The rest of
AaminPay must not depend on raw Wise calls, and the Milestone 5 rules stand: no
Wise credentials in Flutter, sandbox only, no real money.

## Decisions

### One boundary: the `WiseGateway` port

`application/wise/wise-gateway.ts` is the only interface the rest of the backend
uses (Milestone 7 depends solely on it). It takes and returns AaminPay-normalised
value objects (`domain/wise/wise-models.ts`) — money as `bigint` minor units,
rates as exact decimal strings, Wise transfer states verbatim. Nothing outside
`infrastructure/wise/` builds a Wise URL, header or body.

Layers: `WiseHttpClient` (auth, JSON, timeout, retry, error mapping — resource-
agnostic) → `WiseApiClient` (the real endpoints and request/response mapping,
implements `WiseGateway`). Token acquisition (`WiseTokenProvider`), SCA signing
(`WiseScaSigner`) and webhook verification (`RsaWiseWebhookVerifier`) are
separate, individually testable units.

### Only the documented Wise surface

Every endpoint, parameter, header, webhook field and error shape is taken from
the official Wise Platform documentation (linked in
[`../../integrations/wise.md`](../../integrations/wise.md)). Nothing is invented.
A future Wise transfer state that we do not recognise maps to `unknown` rather
than being guessed.

### Authentication

OAuth 2.0 client-credentials (`POST /oauth/token`, HTTP Basic, form
`grant_type=client_credentials`), **or** a pre-issued token from onboarding —
selected by configuration, because the exact token type Wise issues a partner is
an onboarding-contract detail. Tokens live in memory only, refresh proactively,
and are never logged. SCA (funding) is handled with the documented one-time-token

- `X-Signature` retry.

### Configuration and the production guard

`WISE_ENABLED` defaults to `false` — the whole app runs without Wise. When
enabled, a profile id and credentials are required at startup. A production Wise
host (`api.transferwise.com` / `api.wise.com`) is **refused** unless
`WISE_ALLOW_PRODUCTION=true`, so "sandbox only" is enforced, not just documented.
All Wise config is backend-only.

### Idempotency

Transfer creation carries a UUID `customerTransactionId`; Wise dedupes on it, so
the client treats `POST /v1/transfers` as retryable. Funding and cancellation are
not retried (Wise rejects a repeat funding — no duplicate-transfer risk). Webhook
deliveries carry `X-Delivery-Id` for AaminPay-side dedup (Milestone 7).

### Webhooks

`POST /webhooks/wise`, mounted before the JSON parser so signature verification
uses the exact raw bytes. `X-Signature-SHA256` (RSA-SHA256, base64) verified
against Wise's public key (bundled sandbox key, overridable). Bad signature →
401; verified-but-unhandled → 200 (stop Wise retrying). Respond well inside
Wise's 5 s window.

### Testing without a network

Every HTTP interaction goes through an injectable `WiseTransport`. Unit tests use
fake transports + fixtures copied from documented Wise responses
(`test/fixtures/wise/`). The webhook integration test signs bodies with a
generated keypair and a matching `WISE_WEBHOOK_PUBLIC_KEY` override. No live Wise
calls, no real credentials.

## Consequences

- The integration is complete and tested but not yet _used_: Milestone 7 wires
  the send-money orchestration, persistence and webhook-to-record application.
- A small dependency was added: none (uses `node:crypto` and the global `fetch`).
- A few onboarding-contract details are modelled defensively and listed as
  "confirm against the onboarding pack" in the integration doc.
