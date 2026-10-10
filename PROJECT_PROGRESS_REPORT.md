# AaminPay — Project Progress Report

_Generated: 2026-09-09. Describes the repository exactly as it exists on disk._

AaminPay is a UK-based international money-transfer platform. First launch corridor:
**UK → Kenya (GBP → KES)**, with the architecture built to add more corridors later.

> **Headline:** Backend (auth + send-money orchestration) and the database schema
> are implemented and fully tested. The mobile app has authentication working;
> the mobile send-money UI is **partially built and not yet wired in**. The Wise
> Platform integration exists as backend code but is **disabled, credential-less,
> and has never made a live call**. The project is **not production-ready** and
> real-money transfers are not enabled.

---

## 1. Project structure

### 1.1 Top-level layout

```
full-payment-project/
├── backend/        Node.js + TypeScript REST API + PostgreSQL migrations
├── mobile/         Flutter application (Android + iOS)
├── docs/           Architecture decisions, schema, security, ops (20 markdown files, 10 ADRs)
├── README.md
├── .editorconfig  .gitignore  .nvmrc
└── PROJECT_PROGRESS_REPORT.md   (this file)
```

Git: a repository is initialised but **there are no commits** — the entire tree is
currently untracked working-copy.

### 1.2 Backend (`backend/`)

| Aspect | Detail |
| --- | --- |
| Language / runtime | TypeScript on **Node.js 22** (v22.23.0), run **directly via Node's native type-stripping** — no `ts-node`, no build step for dev. `npm run build` (tsc) produces `dist/` for production. |
| Web framework | **Express 5** (`express@^5.1.0`) |
| Validation | **Zod 4** (`zod@^4.1.5`) — strict schemas on every request body/query/params |
| Auth crypto | `@node-rs/argon2@^2.2.0` (Argon2id), `jose@^6` (HS256 JWT) |
| Rate limiting | `express-rate-limit@^8` (in-memory store) |
| Database driver | `pg@^8.13` (node-postgres). BIGINT/NUMERIC read back as **strings** (no float loss). |
| Dependencies total | 6 runtime deps. `npm audit`: **0 vulnerabilities**. |
| Files | ~100 source `.ts`, ~50 test `.ts`, 11 SQL migrations |
| Layout | `src/domain/` (pure types/rules) · `src/application/` (use cases + ports) · `src/infrastructure/` (adapters: database, auth, wise, mail) · `src/interfaces/http/` (Express middleware, routers, webhooks) · `src/config/` · `src/shared/` · `container.ts` (composition root) |

### 1.3 Mobile (`mobile/`)

| Aspect | Detail |
| --- | --- |
| Framework | **Flutter 3.47.2 / Dart 3.13.2** (stable) |
| State management | Plain `ChangeNotifier` controllers + `ListenableBuilder` (no state-management package) |
| Networking | `http@^1.6` with a custom `AuthenticatedClient` (`BaseClient` wrapper: attaches the access token, single-flight refresh-on-401) |
| Secure storage | `flutter_secure_storage@^11` — iOS Keychain (`first_unlock_this_device`, no iCloud sync) / Android Keystore-backed EncryptedSharedPreferences. **Stores only the end user's own access + refresh tokens.** |
| Lints | `flutter_lints@^6` + strict analyzer |
| Environment model | Selected at **build time** via `--dart-define=ALMAPAY_ENV=development|staging|production`. No runtime switching, no secrets in any flavour. |
| Files | 26 `lib/*.dart`, 8 `test/*.dart` |
| Layout | `lib/app/` (shell + environment) · `lib/core/` (auth, network) · `lib/features/<name>/{domain,data,presentation}` · `lib/shared/theme/` |

### 1.4 Database

| Aspect | Detail |
| --- | --- |
| Engine | **PostgreSQL 14+** |
| Migrations | 11 plain-SQL files in `backend/migrations/` (`NNNN_name.sql`, `-- migrate:up` / `-- migrate:down`). Applied in order, each in its own transaction, checksum-tracked in `schema_migrations`. **Not run on boot** — explicit `npm run db:migrate`. |
| Tables | `countries`, `currencies`, `corridors`, `users`, `user_auth`, `auth_sessions`, `auth_tokens`, `recipients`, `fee_rules`, `transfer_quotes`, `quote_fees`, `transfer_statuses`, `transfer_status_transitions`, `transfers`, `transfer_status_history`, `webhook_events`, `audit_events` |
| Money representation | `BIGINT` integer **minor units**; exchange rates `NUMERIC(24,12)`. No floating point anywhere. |
| Integrity enforced by triggers | transfer state machine, frozen financial fields, auto status-history, append-only audit/history, currency-matches-corridor |
| Idempotency | `UNIQUE (user_id, idempotency_key)` on transfers; `UNIQUE (provider, dedupe_key)` on webhook_events; `UNIQUE (quote_id)` on transfers (migration 0011 — see §4) |
| Seed data | UK→Kenya corridor, GBP/KES currencies, an example GBP 1.99 flat fee |

Local test/dev database: Docker Postgres on port **55432** (`postgres:almapay`).
There is **no `backend/.env`** — the backend runs on schema defaults.

### 1.5 Current architecture

- **Backend: clean / hexagonal.** Dependencies point inward. HTTP → application
  use case → port → infrastructure adapter. The composition root
  (`container.ts`) is the only place concrete classes are constructed.
- **Backend is authoritative for money.** The mobile app never computes or sends
  a fee, exchange rate, or transfer status — it only displays what the backend
  returns and sends `quoteId` + `recipientId` + an `Idempotency-Key`.
- **Wise is behind a single port** (`WiseGateway`). Nothing outside
  `infrastructure/wise/` builds a Wise URL, header, or body. When Wise is
  disabled a `nullWiseGateway` makes the send-money endpoints return `503`.
- **Mobile: feature-first clean architecture.** Each feature is a vertical slice
  (`domain` / `data` / `presentation`). Platform specifics sit behind Flutter
  abstractions.
- **Three fully separate environments** (development / staging / production) —
  documented in `docs/development/environments.md`; no shared config, DB, or
  Wise account.

---

## 2. Completed work

### Milestone 1 — Project foundation ✅
Repo structure, backend skeleton (health endpoint, Zod env config, in-house
redacting JSON logger, clean layering, Node built-in test runner), Flutter
skeleton (feature-first, build-time env config, strict analyzer), docs + 5 ADRs.

### Milestone 2 — Database architecture ✅
Full PostgreSQL schema (migrations 0001–0008), state machine + frozen-financials
+ auto-history + append-only enforced by triggers, idempotency constraints,
migration runner + CLI (`db:migrate` / `db:rollback` / `db:status`).
`docs/database/schema.md`, ADR 0006.

### Milestone 3 — Backend API foundation ✅
Response envelope (`{data,meta}` / `{error}` with stable `UPPER_SNAKE` codes),
middleware pipeline (security headers, require-HTTPS, request-context/correlation
id, authenticate, authorize, validate-request, rate-limit), URL-path API
versioning, `GET /api` discovery, `GET /api/v1/me`, `GET /api/v1/admin/whoami`,
`/healthz` + `/readyz`. ADR 0007, `docs/api/README.md`.

### Milestone 5 — Secure authentication ✅
Migration 0009 (`auth_sessions` with rotating hashed refresh tokens + family
reuse detection; `auth_tokens` for single-use hashed email-verification /
password-reset). Argon2id, `SessionService`, use cases: register / login /
refresh / logout / logout-all / verify-email / resend / password forgot + reset.
`authenticate` re-checks session + account in the DB on every request (immediate
revocation). No account enumeration. Per-account lockout + per-client rate limit.
**Mobile:** `SecureTokenStore`, `AuthApi`, `AuthenticatedClient` (refresh-on-401,
single-flight), `AuthRepository(Impl)`, `AuthController`, `AuthGate` +
login/register/home pages, wired via `AuthDependencies`. ADR 0008,
`docs/security/authentication-review.md`.

### Milestone 6 — Wise Platform **Sandbox** integration (backend code only) ✅ (disabled)
`WiseGateway` port + domain models + `WiseApiClient`. `WiseHttpClient`
(injectable transport, timeout via `AbortController`, bounded retry/backoff on
429/5xx/network, every failure mapped to a typed `WiseError`). OAuth
client-credentials **and** static-token providers (token cached in memory,
never logged). SCA one-time-token signer. `RsaWiseWebhookVerifier`
(`X-Signature-SHA256`). `POST /webhooks/wise` route (raw body, signature-verified
before the JSON parser). Production-host guard. ADR 0009,
`docs/integrations/wise.md`. **`WISE_ENABLED` defaults to `false`; no credentials
are configured; no live call has ever been made.** See §7.

### Milestone 7 — Send-money flow (backend) ✅ / (mobile) 🟡 partial
**Backend — complete and tested:**
- `POST /api/v1/quotes` — applies AaminPay's configured fee to a Wise quote,
  stores an immutable `transfer_quotes` row with an expiry.
- `GET|POST /api/v1/recipients` — validated recipient management (masked account
  identifiers in responses).
- `POST /api/v1/transfers` — requires `Idempotency-Key`; creates + submits +
  funds the transfer via the Wise gateway; three-layer idempotency.
- `GET /api/v1/transfers` / `GET /api/v1/transfers/:id` (best-effort status
  re-sync from Wise) / `POST /api/v1/transfers/:id/cancel`.
- `apply-wise-transfer-update` — forward-only status reconciliation from a
  verified webhook or a status poll.
- Migration 0010 — reworked the transfer state set to
  `created → awaiting_payment → processing → completed`, plus `failed`,
  `cancelled`, `refunded`, matching the Wise lifecycle.
- Full integration test file (`test/integration/send-money/`) driving the flow
  with an injected fake Wise gateway: happy path, duplicate, race, Wise-create
  failure, funding rejection, cancellation, signed webhook → completed,
  unknown-transfer webhook. ADR 0010.

### Production-readiness assessment ✅ (document only)
`docs/operations/production-readiness.md` — full checklist and go-live gate.
Conclusion: **not production-ready**; 21 blocking items enumerated.

---

## 3. In-progress / incomplete work

### 3.1 Mobile send-money UI — 🟡 partially built, NOT active
Files exist under `mobile/lib/features/send_money/`:

| File | State |
| --- | --- |
| `domain/models.dart` | Money, Quote, Recipient, Transfer, TransferStatus, NewRecipient — done |
| `domain/send_money_repository.dart` | interface — done |
| `data/send_money_api.dart` | typed HTTP wrapper over the send-money endpoints — done |
| `data/send_money_repository_impl.dart` | impl + `newIdempotencyKey()` — done |
| `presentation/send_money_controller.dart` | `ChangeNotifier` driving the flow — done |
| `presentation/send_money_flow_page.dart` | multi-step screen (amount → quote → recipient → confirm → status) — done |
| `presentation/widgets/amount_row.dart` | quote breakdown widget — done |

**Not done:**
- **Not wired in** — no reference from `main.dart`, `AuthDependencies`,
  `AaminPayApp`, or `HomePage`. There is no way to reach these screens in the
  running app. `HomePage` is still the placeholder "Signed in" screen.
- **No tests** for any send_money file (0 of the 8 mobile test files cover it).
- No DI/composition wiring, no navigation entry point.

`flutter analyze` **does** pass on these files.

### 3.2 Security audit — 🟡 in progress
A security review was under way. One artefact landed:
- `backend/migrations/0011_one_transfer_per_quote.sql` — `UNIQUE (quote_id)` on
  `transfers`, to stop a retry with a fresh idempotency key from creating a
  second transfer off one quote. **The migration is applied in the test DB and
  all tests pass, but the application layer was not updated:** `confirm-transfer`
  does not yet catch this constraint gracefully, so a same-quote retry with a
  new key currently fails with a generic `500` instead of returning the original
  transfer. **Incomplete.**

Other audit findings identified but **not yet fixed** (detailed in
`docs/operations/production-readiness.md` §1 and §7):
- `JWT_SECRET` example placeholder passes validation — no production guard (G3).
- Webhook de-duplication keys on the unauthenticated `X-Delivery-Id` header
  rather than a hash of the signed body.
- `NODE_ENV` is not tied to `WISE_ALLOW_PRODUCTION` (G1); webhook key falls back
  to the bundled sandbox key even for a production host (G2).

### 3.3 Explicitly deferred (not started)
KYC / identity verification, MFA / step-up auth, breached-password (HIBP) check,
real transactional-email delivery, Redis-backed rate-limit / session / token
cache, mobile deep-link handling, CI/CD, Dockerfile / IaC, monitoring /
alerting / DR / incident-response tooling, fraud / velocity controls,
application-level field encryption for recipient bank details.

---

## 4. Tests

All commands below were run for this report on 2026-09-09.

### 4.1 `flutter analyze`
```
Analyzing mobile...
No issues found! (ran in 4.2s)
```
**Result: PASS — 0 issues.** (Covers the send_money feature files too.)

### 4.2 `flutter test`
```
00:01 +33: All tests passed!
```
**Result: PASS — 33/33 tests.** Coverage: `app_config`, `app_environment`,
`secure_token_store`, `authenticated_client`, `auth_controller`,
`auth_repository_impl`, `auth_gate`. **No tests for the send_money feature.**

### 4.3 Backend — static checks
| Check | Command | Result |
| --- | --- | --- |
| Formatting | `npx prettier --check` | **PASS** — all files conform |
| Types | `npm run typecheck` (`tsc --noEmit`) | **PASS** — 0 errors |
| Lint | `npm run lint` (`eslint .`) | **PASS** — 0 errors/warnings |

### 4.4 Backend — test suite (`npm test`, with `DATABASE_URL` set)
```
# unit         tests 178   pass 178   fail 0   skipped 0
# integration  tests 55    pass 55    fail 0   skipped 0
```
**Result: PASS — 233/233 tests** (55 integration tests require `DATABASE_URL`
and are skipped without it; the Docker Postgres on port 55432 was up).

### 4.5 Dependency audit
`npm audit --omit=dev` → **0 vulnerabilities** (run earlier this cycle;
lockfile unchanged since).

### 4.6 Not run / not present
- No end-to-end tests against a live backend.
- No load/performance tests.
- No mobile integration (`integration_test/`) tests — only widget/unit tests.
- No CI pipeline exists to run any of the above automatically.

---

## 5. Known issues, warnings, TODOs, incomplete areas

### Code TODOs (grep of source)
| Location | Note |
| --- | --- |
| `mobile/android/app/build.gradle.kts:18` | `TODO: Specify your own unique Application ID` (currently `com.almapay.almapay`) |
| `mobile/android/app/build.gradle.kts:34` | `TODO: Add your own signing config` — **release build is signed with the debug keystore** |
| `mobile/lib/app/environment/app_config.dart` | staging/production backend hosts are `*.almapay.example` **placeholders** |
| `mobile/lib/features/home/presentation/home_page.dart` | placeholder landing screen ("a placeholder until the send-money feature lands") |
| `backend/src/infrastructure/mail/logging-mailer.ts` | placeholder mailer — **no real email is ever sent, in any environment** |

### Functional gaps
- Mobile send-money screens are built but unreachable (§3.1).
- Migration 0011 not handled in `confirm-transfer` (§3.2) — same-quote retry → 500.
- In production, email verification / password reset generate tokens that are
  never delivered (no mailer) — and money endpoints are gated on a verified
  email.
- `/readyz` checks the database only, not Wise.
- Transfer amount limits (`min £1 / max £25,000`) are hard-coded in
  `application/transfer/reference.ts`, not configurable.

### Configuration / operational gaps (see `docs/operations/production-readiness.md`)
- `NODE_ENV` defaults to `development`; nothing enforces `production` in prod.
- `JWT_SECRET` example value is long enough to pass validation.
- Rate-limit store is in-memory (single-instance only).
- No CI/CD, no Dockerfile, no IaC, no backups/monitoring/alerting/DR runbooks.
- Mobile default env is `development` → cleartext `http://10.0.2.2:3000`.
- Android `allowBackup` not set; no per-flavour bundle ids; no obfuscation.

### Non-blocking warnings
- `flutter pub outdated`: 8 transitive packages have newer minor versions
  incompatible with current constraints. Analyzer + tests still clean.

---

## 6. Security status — measures already implemented

**Authentication & sessions**
- Argon2id password hashing (`@node-rs/argon2`); NIST-style length policy + small
  weak-list; automatic rehash on login.
- HS256 JWT access tokens, 15-minute TTL, `sid` (session) claim.
- **Session + account status re-checked in the DB on every authenticated
  request** → logout / revocation / suspension take effect immediately.
- Opaque 256-bit refresh tokens, stored only as SHA-256 hashes, **rotate on every
  use**, with **token-family reuse detection** (a replayed old token revokes the
  whole family).
- Per-account login lockout (5 fails / 15 min) + per-client rate limiting.
- **No account enumeration** — identical responses for
  register/login/forgot-password whether or not the address exists, with Argon2
  timing equalisation (dummy-hash verify on the missing-account path).
- Email addresses verified before any money operation (`requireVerifiedEmail`).

**API surface**
- Every request body / query / params validated with **strict Zod schemas**
  (unknown fields rejected); typed values only reach handlers.
- Single response envelope; unmapped errors become a generic `500` — no stack
  traces, SQL, internal ids, or secrets in responses.
- Security headers on every response: `Content-Security-Policy: default-src
  'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy`,
  `Cache-Control: no-store`, HSTS in production. `x-powered-by` disabled. No CORS
  (mobile-only API).
- HTTPS enforced at the app layer in production (behind a trusted proxy).
- Global + sensitive (auth/admin/transfer-confirm) rate limiters.

**Data & database**
- **All SQL is parameterised** (`pg` placeholders) — reviewed, no string
  interpolation of user input.
- Money stored as `BIGINT` minor units; decimal↔minor conversion is exact string
  arithmetic — **never `parseFloat`**.
- DB triggers enforce the transfer state machine, freeze financial columns after
  creation, and make `audit_events` / `transfer_status_history` append-only.
- Per-request `statement_timeout` (15s) on the app connection pool.
- Access is user-scoped in every query (`WHERE user_id = $1`); cross-account
  reads are rejected (`GET /transfers/:id`, cancel, confirm all check ownership).

**Idempotency & money integrity**
- Client-supplied `Idempotency-Key` required for transfer confirmation.
- Three layers: fast lookup by `(user, key)` → DB unique constraint catches a
  race → Wise `customerTransactionId` dedupe.
- `UNIQUE (quote_id)` on transfers (migration 0011) — DB-level backstop against a
  regenerated-key retry (application handling still pending, §3.2).
- Backend is the sole authority on fee, exchange rate, and transfer status;
  status only ever advances forward.

**Wise integration**
- OAuth/access token held **in memory only**, refreshed proactively, **never
  logged**; `Authorization` header, request bodies and response bodies are never
  logged.
- Inbound webhooks verified by **RSA-SHA256 signature** against Wise's public key
  before any processing; bad signature → `401`.
- Delivery de-duplication via `webhook_events` unique constraint.
- Production Wise host **refused at startup** unless `WISE_ALLOW_PRODUCTION=true`;
  sandbox simulation endpoint refuses to run outside sandbox.
- All Wise config is backend-only.

**Logging**
- Structured JSON logger with **key-based redaction**
  (`password`, `secret`, `token`, `authorization`, `api_key`, `private_key`,
  `card_number`, `cvv`, `pan`, `iban`, `sort_code`, `account_number`, `ssn`,
  `pin`, …). Request and response bodies are never logged.
- Audit entries carry ids + amounts only — no account numbers, names, or tokens.
- Reset / verification links are withheld from logs in production.

**Mobile**
- Tokens stored only in the platform Keychain / Keystore; not synced to iCloud;
  `AuthTokens.toString()` is redacted.
- iOS App Transport Security enforced (no arbitrary-loads exception).
- **No Wise secrets, credentials, keys, profile ids, or endpoints anywhere in the
  mobile codebase** (verified by full grep).
- No custom URL schemes / deep links declared (no deep-link attack surface).
- App holds only non-sensitive config (backend URL, display name).

**Known security gaps** are catalogued in
`docs/operations/production-readiness.md` (§1 verification results, §2.15,
§7 blocking items) and summarised in §5 above.

---

## 7. Wise integration — current status (explicit)

- **A production / real-money Wise integration has NOT been implemented.**
- What exists: **backend Sandbox-oriented integration _code_** from Milestone 6 —
  a `WiseGateway` abstraction, an HTTP client, token providers, an SCA signer,
  and a webhook verifier. It is **disabled by default** (`WISE_ENABLED=false`).
- **No Wise API credentials exist** in the repository, in any `.env` file (there
  is no `backend/.env`), or anywhere else. None were invented.
- **No Wise endpoints were invented.** The implemented paths follow the official
  Wise Platform documentation, which is cited in `docs/integrations/wise.md`.
- **The integration has never made a live call** — there are no credentials, and
  every automated test uses an injected fake gateway or a mock HTTP transport
  with local fixtures.
- **No Wise secrets are exposed** — not in the backend responses, not in logs,
  and **not in the mobile app** (confirmed by grep).
- Production Wise hosts (`api.transferwise.com`, `api.wise.com`) are **actively
  refused at startup** unless `WISE_ALLOW_PRODUCTION=true` is explicitly set.
- Wise has **not** approved AaminPay; onboarding is pending (see
  `docs/operations/production-readiness.md` §2.1).
- AaminPay's intent to investigate **Wise Platform Embedded** is noted; the actual
  integration will be built later against official documentation only.

---

## 8. How to run what exists

**Backend**
```bash
cd backend
# needs a PostgreSQL database; set DATABASE_URL and JWT_SECRET (min 32 chars)
npm install
npm run db:migrate        # apply migrations
npm run dev               # start on PORT (default 3000)
npm test                  # unit + integration (integration needs DATABASE_URL)
npm run typecheck && npm run lint
```

**Mobile**
```bash
cd mobile
export PATH="$PATH:/home/tryhackme/flutter/bin"
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=ALMAPAY_ENV=development   # points at http://10.0.2.2:3000
```

The mobile app currently supports **register → verify email → login → placeholder
home screen**. The send-money screens are not reachable (§3.1).
