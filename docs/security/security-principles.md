# Security principles

AaminPay moves real money. These rules are non-negotiable and apply to every
change. They restate and operationalise the project's core security rules.

## Secrets

1. **No secrets in the Flutter app.** No Wise credentials, backend secrets,
   private keys, database credentials, encryption keys or privileged API
   credentials. The mobile binary is public.
2. **No secrets in git.** Only `*.example` env files are committed. `.env`,
   keystores, `*.pem`/`*.key`/`*.p12`, `google-services.json` and
   `GoogleService-Info.plist` are git-ignored repo-wide.
3. **No hardcoded credentials anywhere** — passwords, API keys, tokens,
   certificates, private keys, DB credentials, encryption keys.
4. Backend secrets come from environment variables / a secrets manager, injected
   by the deployment platform. Separate values per environment.
5. **Least privilege.** Every credential and DB role has the minimum scope needed.

## Client/server trust boundary

6. Never trust a value from the mobile app. Fees, exchange-rate displays,
   transfer amounts, recipient status and transfer state are calculated and
   owned by the backend.
7. Every protected operation is authorised server-side.
8. All input is validated on the backend, regardless of client-side validation.
9. A transfer is **never** marked successful based on the mobile app. Success
   requires the backend to have verified the provider's transaction status.
10. The client can never choose or modify a final transfer status.

## Wise integration

The Wise Platform Sandbox integration landed in Milestone 6
([ADR 0009](../architecture/adr/0009-wise-integration.md),
[integration doc](../integrations/wise.md)). The rules it upholds:

11. Wise is an external financial system; its status is always verified
    server-side. All Wise communication is server-side; no Wise credential,
    client secret or private key is ever in the mobile app.
12. Only the documented Wise API surface is used — no invented endpoints,
    parameters, scopes or webhook formats. An unknown Wise transfer state maps to
    `unknown`, not a guess.
13. Sandbox only. A production Wise host is refused at startup unless
    `WISE_ALLOW_PRODUCTION=true`. No real money, no real customer data.
14. Webhook signatures (`X-Signature-SHA256`, RSA-SHA256) are verified against
    Wise's public key before any processing; a bad signature → 401.
15. Financial operations are idempotent: transfer creation carries a
    `customerTransactionId` UUID (Wise dedupes on it), and webhook deliveries are
    deduped on `X-Delivery-Id`. Wise audit logging records ids, statuses and
    amounts only — never account numbers, sort codes, IBANs, holder names or
    tokens.

## Send-money flow

The customer send-money flow landed in Milestone 7
([ADR 0010](../architecture/adr/0010-send-money-flow.md),
[API reference](../api/README.md#send-money-flow)). It upholds principles 6–10:

16. The quote is an immutable server-side resource. The client receives an
    opaque `quoteId` and display strings; it cannot submit a fee or rate, and
    confirmation (`quoteId` + `recipientId` + `Idempotency-Key`) re-reads the
    stored quote. An expired quote is rejected.
17. `POST /api/v1/transfers` is idempotent at three layers — a fast lookup by
    `(user_id, idempotency_key)`, a unique constraint that catches a race, and
    Wise's own `customerTransactionId` dedup. A duplicate request always returns
    the original transfer and never moves money twice.
18. Transfer status is only ever advanced by `apply-wise-transfer-update`, from a
    signature-verified webhook or a server-side status poll, and only forwards —
    an out-of-order or backwards transition is logged and ignored. The DB state
    machine (trigger-enforced) is the backstop.
19. A Wise submission failure transitions the AaminPay transfer to `failed` with a
    mapped reason and audits it; the record is never left dangling.
20. All money-movement endpoints require a verified email.

## Data protection

21. HTTPS/TLS for all production communication.
22. Do not use real customer data in development or test.
23. Do not store unnecessary personal data. Encrypt sensitive data at rest where
    appropriate.
24. Never log passwords, access/refresh tokens, card data, full identity
    documents or other sensitive financial data. The backend logger redacts
    known-sensitive keys — do not defeat it by logging secrets inside message
    strings.

## Operations

25. Rate limiting and abuse protection on sensitive endpoints. (Global +
    auth-sensitive limiters are in place; see
    [ADR 0007](../architecture/adr/0007-api-foundation.md).)
26. Secure authentication and session management (implemented in Milestone 5):
    Argon2id password hashing; short-lived HS256 access tokens + opaque,
    hashed, rotating refresh tokens with reuse detection; per-account lockout;
    per-client rate limiting; no account enumeration; immediate revocation
    (session checked on every request). Mobile tokens live only in the platform
    keystore. See [ADR 0008](../architecture/adr/0008-authentication.md) and the
    [authentication security review](authentication-review.md). Extensions (MFA,
    breached-password checks, step-up auth) must not be improvised.
27. Separate development, test/sandbox and production configurations — never
    shared. `DATABASE_URL` and `JWT_SECRET` come from the environment; the
    example file holds only a clearly-marked dev placeholder.

## API responses

28. One response envelope for every endpoint. Errors carry a stable `code` and a
    safe `message` only — never stack traces, internal identifiers, SQL, or
    secret values. An unmapped error is a generic `INTERNAL` 500, correlated to
    the logs by `requestId`.

## Review checklist (per pull request)

- [ ] No secret, key or credential added to source, tests, fixtures or config.
- [ ] No new value trusted from the client without backend validation.
- [ ] No financial value computed or finalised on the client.
- [ ] New endpoints: authorisation, input validation, rate limiting considered.
- [ ] New external calls: server-side only, status verified server-side.
- [ ] Logging: no sensitive data; structured.
- [ ] Non-obvious security decisions documented (code comment or ADR).
