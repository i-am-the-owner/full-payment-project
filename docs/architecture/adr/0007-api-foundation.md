# 7. Backend API foundation

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Milestone 3 builds the REST API foundation that every later feature sits on:
request pipeline, response format, authentication and authorization, HTTP
hardening, rate limiting, and the database connection. No money-movement or Wise
code is included.

## Decisions

### Response envelope

Every endpoint returns one of two shapes:

```jsonc
// success
{ "data": <payload>, "meta": { "requestId": "…", "timestamp": "…" } }
// error
{ "error": { "code": "UPPER_SNAKE", "message": "…", "requestId": "…",
             "timestamp": "…", "fieldErrors": [ { "field": "body.x", "message": "…" } ] } }
```

`code` is a stable, client-safe enum (`VALIDATION_ERROR`, `UNAUTHORIZED`,
`FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`,
`SERVICE_UNAVAILABLE`, `INTERNAL`). `message` is human-readable and safe to show.
Internal error text, stack traces and secrets never appear in a response — an
unmapped error becomes a generic `INTERNAL` 500 and is logged server-side with
the `requestId`.

### API versioning

URL path versioning: `/api/v{n}`. `GET /api` lists versions. A new major version
is created **only** for breaking changes; additive changes ship within the
current version. Infra probes (`/healthz`, `/readyz`) are unversioned and live
outside `/api`.

### Authentication

Stateless HS256 **access tokens** (JWT), verified with the `jose` library —
cryptographic token handling is not hand-rolled. `algorithms: ['HS256']` is
pinned (no `alg` negotiation, `alg: none` rejected); issuer and audience are
checked; `sub`, `jti` and a closed set of `roles` are required. The
`authenticate` middleware attaches an `AuthenticatedPrincipal` to `req.auth`;
the raw token is never logged.

Credential login, refresh tokens and token revocation are a later milestone.
The access-token TTL is short (default 15 min) so revocation pressure lands on
the refresh layer when it is built.

### Authorization

`authorize(...roles)` middleware, run after `authenticate`, requires the
principal to hold at least one of the listed roles (403 otherwise). Roles come
only from the verified token, never from the request body/query.

### HTTP hardening

- Security headers set by a small in-house middleware (JSON-only API, so CSP is
  `default-src 'none'`): `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Cross-Origin-*`, `Permissions-Policy`, `Cache-Control:
no-store`, and HSTS in production. `X-Powered-By` disabled.
- **No CORS headers.** The client is the mobile app, not a browser. A CORS
  allowlist would be added deliberately if a web client appears.
- `express.json()` body limit 32 kB.
- `require-https` middleware rejects plain HTTP in production behind a trusted
  proxy (`TRUST_PROXY`).
- Per-statement DB timeout (15 s) so a stuck query cannot pin a connection.

### Rate limiting

`express-rate-limit` (chosen over a hand-rolled limiter: correct headers, and a
pluggable store so a Redis backend can slot in for multi-instance deploys). Two
limiters: a coarse global one on all of `/api`, and a stricter one for
auth-sensitive routes (admin now; login/refresh/password-reset later). Limits are
configurable; a 429 flows through the standard error envelope with `Retry-After`.

### Database connection

A single `pg.Pool` built in the composition root, closed on shutdown. `/readyz`
runs `SELECT 1` (with a 2 s timeout) and returns 503 if it fails. Migrations are
**not** run on boot — they are a deliberate deploy step (`npm run db:migrate`).

### New dependencies

`jose` (JWT) and `express-rate-limit`. Both are small, well-maintained, and cover
security-sensitive ground where hand-rolling is the wrong call.

## Consequences

- `DATABASE_URL` and `JWT_SECRET` are now required to start the backend;
  integration tests need a real database (they skip when `DATABASE_URL` is
  unset).
- Integration test files run serially (`--test-concurrency=1`) because they share
  one database.
- Every future endpoint reuses `authenticate` / `authorize` / `validateRequest`
  and the response helpers; controllers stay thin.
