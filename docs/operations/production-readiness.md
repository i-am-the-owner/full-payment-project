# AlmaPay production-readiness checklist

**Status: NOT READY FOR PRODUCTION. Real-money transfers are not enabled and
must not be enabled until every _Blocking_ item below is closed and signed off.**

- Prepared: 2026-09-09
- Scope: backend (`backend/`), mobile app (`mobile/`), database, Wise Platform
  integration, operations.
- Current build state: Milestones 1–7 implemented (auth, DB schema, API
  foundation, Wise Sandbox integration, send-money flow). Wise is **disabled by
  default** (`WISE_ENABLED=false`); the send-money endpoints return `503` until
  it is configured.

Legend: ✅ done · 🟡 partial / needs work · ❌ not started · N/A

---

## 1. Verification results (explicitly requested)

### 1.1 Sandbox and production Wise configuration cannot be accidentally mixed

**Partly enforced. Two gaps.**

What is enforced (`backend/src/config/wise-config.ts`, tested in
`backend/test/unit/config/wise-config.test.ts`):

- `PRODUCTION_HOSTS = {api.transferwise.com, api.wise.com}`. If
  `WISE_API_BASE_URL` resolves to either host and `WISE_ALLOW_PRODUCTION` is not
  `true`, startup **throws `WiseConfigError`** and the process does not boot.
- `isSandbox` is derived from the host (`!isProductionHost`) and is threaded
  through to the API client. `WiseApiClient.simulateTransferTransition()` — the
  only sandbox-simulation call — **throws unless `isSandbox`**, so the sandbox
  test hook is inert against production.
- Default `WISE_API_BASE_URL` is the sandbox host; default `WISE_ENABLED=false`.
- The three environments are documented as fully separate
  (`docs/development/environments.md`): separate config, credentials, data
  stores and Wise accounts.

Gaps (**Blocking — see §7**):

- **G1 — `NODE_ENV` is not tied to `WISE_ALLOW_PRODUCTION`.** Nothing stops
  `NODE_ENV=development` (verbose logging, reset-link logging, dev rate limits)
  from running with `WISE_ALLOW_PRODUCTION=true` and real Wise credentials.
  Required: refuse a production Wise host unless `NODE_ENV=production`.
- **G2 — the webhook public key silently falls back to the bundled _sandbox_
  key.** `loadWiseConfig` uses `WISE_SANDBOX_WEBHOOK_PUBLIC_KEY` whenever
  `WISE_WEBHOOK_PUBLIC_KEY` is unset, even for a production host. A production
  deploy that forgets the key verifies real webhooks against the sandbox key
  (fails closed — every webhook `401`s — but is silently broken, and hides a
  misconfiguration). Required: when `!isSandbox`, `WISE_WEBHOOK_PUBLIC_KEY`
  (and, if SCA is used, `WISE_SCA_PRIVATE_KEY`) **must be set explicitly**;
  refuse to fall back to the bundled sandbox key.

### 1.2 No development credentials or test endpoints usable in production

**Confirmed for endpoints. One credential gap.**

- **No debug/test/dev HTTP routes exist.** Grep of `src/interfaces/` for
  `/debug`, `/test`, `/internal`, `/__`, `NODE_ENV`-gated routes: none.
- The Wise sandbox simulation call is **not exposed over HTTP** and is
  `isSandbox`-guarded.
- `NODE_ENV` branches in code are limited to: reset/verification-link logging
  (`LoggingMailer`, off in production), HSTS (on in production), HTTPS
  enforcement (on in production behind a proxy). Reviewed and safe.
- **G3 — `JWT_SECRET` placeholder is a valid value (Blocking).**
  `backend/.env.example` ships `JWT_SECRET=dev-only-insecure-secret-change-me-0123456789`,
  which is ≥32 chars and therefore passes validation. If a deployment copies the
  example and forgets to override it, **every access token is forgeable →
  complete authentication bypass, any user, any role.** Required: reject this
  known placeholder (and other low-entropy values) when `NODE_ENV=production`.
- **G4 — `NODE_ENV` defaults to `development`.** If a production deploy does not
  set `NODE_ENV=production` explicitly it runs in development mode (no HSTS, no
  HTTPS enforcement, reset links logged, dev rate limits). Required: a startup
  assertion or a deploy-pipeline gate that `NODE_ENV=production` in prod.
- **G5 — no real mailer.** `LoggingMailer` is wired in all environments. In
  production it sends nothing and logs nothing (URLs suppressed), so email
  verification and password reset are non-functional. Since money movement is
  gated on a verified email, this is Blocking for go-live (tracked separately as
  "real email delivery").

### 1.3 The mobile application contains no Wise secrets

**Confirmed.**

Full grep of `mobile/lib`, `mobile/android`, `mobile/ios`, `mobile/pubspec.yaml`
for `wise`, `transferwise`, `client_secret`, `oauth`, `sca`, `x-2fa`,
`profile_id`, `api_token`, `BEGIN … PRIVATE KEY`:

- The **only** match is a documentation comment in
  `mobile/lib/app/environment/app_config.dart` stating that Wise credentials,
  signing keys and secrets never live in the mobile app.
- `AppConfig` carries only non-sensitive values: the backend base URL and the
  display name. Staging/production URLs are `*.almapay.example` placeholders.
- The app persists **only the end user's own** access/refresh tokens, in
  platform secure storage (`SecureTokenStore` → Keychain / Keystore-backed
  EncryptedSharedPreferences). `AuthTokens.toString()` is redacted.
- All privileged Wise calls are server-side, behind the `WiseGateway` port.

No Wise secret, client credential, private key, profile id, or Wise endpoint is
present in the mobile codebase or build inputs.

---

## 2. Backend / infrastructure

### 2.1 Wise production credentials — ❌

| Item                                                                                                                   | State                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Wise partner onboarding complete, production access approved                                                           | ❌ pending business approval                   |
| Production `WISE_CLIENT_ID` / `WISE_CLIENT_SECRET` **or** `WISE_API_TOKEN` issued and stored in the secrets manager    | ❌                                             |
| Production `WISE_PROFILE_ID` (business profile) recorded                                                               | ❌                                             |
| Production `WISE_API_BASE_URL` set to `https://api.wise.com` (or the onboarded host) with `WISE_ALLOW_PRODUCTION=true` | ❌                                             |
| Auth mode (client-credentials vs. pre-issued token) confirmed against the onboarding pack                              | ❌ — code supports both (`buildTokenProvider`) |
| Wise account funded via the approved treasury process; funding/settlement runbook written                              | ❌                                             |
| Rate limits / quotas for the production Wise app documented and alerted on                                             | ❌                                             |
| Production webhook subscription created in Wise with the AlmaPay `/webhooks/wise` URL; delivery tested end-to-end      | ❌                                             |

### 2.2 mTLS / certificates — 🟡 confirm requirement

- Wise Platform authentication as implemented is **OAuth 2.0 bearer over TLS**
  (client-credentials or static token) — no client certificate.
- **SCA (Strong Customer Authentication)** for funding uses request signing with
  an RSA private key (`WISE_SCA_PRIVATE_KEY`, `WiseScaSigner`, `X-Signature`
  header). Confirm with onboarding whether SCA applies to AlmaPay's flow; if so:
  - [ ] Generate the RSA keypair in an HSM or the secrets manager; register the
        **public** key with Wise.
  - [ ] Store the private key only in the secrets manager; never in the repo,
        an image layer, or an env file on disk.
  - [ ] Key-rotation procedure documented.
- [ ] Confirm with Wise whether **mutual TLS** is required for the API or
      webhook channel for AlmaPay's product. If yes, provision the client
      certificate, add it to the outbound HTTP client, and add a
      certificate-expiry alert. (Not currently implemented — `fetch` with the
      default trust store.)
- [ ] TLS to Wise: pin to TLS 1.2+; document whether Wise certificate pinning
      is desired (adds an outage risk on their cert rotation — decide
      explicitly).

### 2.3 Secrets management — 🟡

| Item                                                                                                                                                                                          | State                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| No secrets in the repo                                                                                                                                                                        | ✅ verified (`.gitignore` covers `.env*`, `*.pem`, `*.key`, keystores; grep for live keys / private keys / JWTs = clean) |
| `.env.example` contains only placeholders                                                                                                                                                     | ✅ (but see G3 — the JWT placeholder is a functional value)                                                              |
| Production/staging secrets sourced from a managed secrets store (not files, not image layers)                                                                                                 | ❌ no deployment defined yet                                                                                             |
| Secret inventory: `DATABASE_URL`, `JWT_SECRET`, `WISE_CLIENT_ID/SECRET` or `WISE_API_TOKEN`, `WISE_PROFILE_ID`, `WISE_WEBHOOK_PUBLIC_KEY`, `WISE_SCA_PRIVATE_KEY`, mail provider key (future) | 🟡 documented in `.env.example`; ownership/rotation not defined                                                          |
| Rotation procedure + cadence per secret                                                                                                                                                       | ❌                                                                                                                       |
| `JWT_SECRET` ≥ 48 bytes of CSPRNG entropy, unique per environment                                                                                                                             | ❌ to be generated                                                                                                       |
| Access to secrets is least-privilege and audited                                                                                                                                              | ❌                                                                                                                       |
| Secret-scanning in CI (e.g. gitleaks) blocking merges                                                                                                                                         | ❌ no CI                                                                                                                 |

### 2.4 Database backups — ❌

- [ ] Automated managed backups enabled (daily full + WAL/PITR).
- [ ] Retention defined (e.g. 30 days PITR, longer for monthly snapshots) and
      aligned with the data-retention / privacy policy.
- [ ] **Restore tested** — a real restore into a scratch environment, timed,
      documented (RPO/RTO measured, not assumed).
- [ ] Backups encrypted at rest; backup storage access audited.
- [ ] Backups in a separate account/region from the primary.
- [ ] Pre-migration snapshot step in the deploy runbook (see §5).

### 2.5 Monitoring — ❌

- [ ] Metrics: request rate / latency / error rate per route; `4xx` vs `5xx`;
      DB pool saturation (`pg` pool has `max`, `connectionTimeoutMillis`,
      `statement_timeout=15s` — expose waiting-count and timeouts);
      Wise call latency / error-code breakdown (the client logs
      `wise.request` with `method`, `path`, `status`, `durationMs`, `attempt`);
      webhook receipt rate and `processing_status` mix.
- [ ] Business metrics: quotes created, transfers created / funded / completed /
      failed / refunded, funnel drop-off, fee revenue, float balance.
- [ ] `/healthz` (liveness) and `/readyz` (readiness — currently DB `SELECT 1`
      only) wired to the orchestrator. **Add a Wise reachability check to
      `/readyz` or a separate degraded-mode signal** so a Wise outage is
      visible.
- [ ] Uptime / synthetic checks from outside the VPC.
- [ ] Dashboards published; on-call can find them.

### 2.6 Alerting — ❌

- [ ] Paging alerts: `5xx` rate spike, `/readyz` failing, DB unreachable / pool
      exhausted, Wise `wise_auth` failures (token/credential problem), Wise
      `wise_unavailable` sustained, webhook deliveries failing signature
      verification (possible attack or key mismatch), webhook backlog
      (`processing_status='pending'` aging), transfer stuck in a non-terminal
      state beyond SLA, funding rejections, float balance below threshold.
- [ ] Non-paging alerts: elevated login failures / lockouts, elevated
      `4xx` validation failures, dependency-audit findings, cert expiry (30/7
      days), rate-limit store anomalies.
- [ ] Alert routing, escalation policy, and silence/maintenance procedure.
- [ ] Every alert links to a runbook.

### 2.7 Logging — 🟡

| Item                                                                                                                                                                                | State                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structured JSON logs, one line per request (`requestId`, method, route, status, duration)                                                                                           | ✅ (`src/shared/logger.ts`, `request-context.ts`)                                                                                                                                    |
| Built-in key redaction (`pass*`, `secret`, `token`, `authorization`, `api_key`, `private_key`, `card_number`, `cvv`, `pan`, `iban`, `sort_code`, `account_number`, `ssn`, `pin`, …) | ✅                                                                                                                                                                                   |
| Request/response bodies never logged                                                                                                                                                | ✅                                                                                                                                                                                   |
| Wise `Authorization` header, request body, response body never logged                                                                                                               | ✅ (`WiseHttpClient.#log`)                                                                                                                                                           |
| Audit context is ids + amounts only (no account numbers, names, tokens)                                                                                                             | ✅ (spot-checked `wise-api-client`, `confirm-transfer`, `add-recipient`)                                                                                                             |
| **Reset / verification links (single-use tokens) not logged in production**                                                                                                         | ✅ in `production`; 🟡 logged in `development` (`LoggingMailer` `includeUrls`). Ensure staging runs `NODE_ENV=production` so it does **not** log them, or drop URL logging entirely. |
| Redaction is key-based, not value-based — a secret placed in a message string or under a non-matching key would not be caught                                                       | 🟡 known limitation; keep the "never log secrets in message strings" rule (security principle 24) enforced in review                                                                 |
| Central log aggregation, retention policy, access control, tamper-evidence                                                                                                          | ❌ no platform                                                                                                                                                                       |
| PII in logs minimised (email addresses are logged in `mail.send` and some audit paths) and covered by the privacy policy / retention                                                | 🟡 review before go-live                                                                                                                                                             |
| Log volume / cost budget and sampling strategy                                                                                                                                      | ❌                                                                                                                                                                                   |

### 2.8 Audit logs — 🟡

| Item                                                                                                                                                                    | State                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Append-only `audit_events` table; `UPDATE`/`DELETE` blocked by trigger                                                                                                  | ✅ (`0008_webhooks_and_audit.sql`)                                                      |
| Auth events audited (login success/failure, lockout, register, refresh reuse, logout, password reset, email verify)                                                     | ✅                                                                                      |
| Money events audited (quote created, transfer confirmed / submitted / failed / cancelled, Wise transfer created / funded / cancelled, status changes, webhook received) | ✅                                                                                      |
| Actor, entity, request id, IP recorded                                                                                                                                  | ✅                                                                                      |
| Write failure never breaks the request (logged and swallowed)                                                                                                           | ✅ — **acceptable, but add an alert on `audit.write_failed`** so audit gaps are visible |
| `transfer_status_history` append-only, records `provider_webhook` vs `system` actor                                                                                     | ✅ (`0010_send_money.sql`)                                                              |
| Audit retention (7+ years for financial records — confirm against UK regulatory requirements), export, and legal-hold procedure                                         | ❌                                                                                      |
| Audit log shipped to write-once / separate-account storage                                                                                                              | ❌                                                                                      |
| Who can read audit data, and is that access itself audited                                                                                                              | ❌                                                                                      |

### 2.9 Rate limits — 🟡

| Item                                                                                                                                                                                       | State                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Global per-IP limiter on the whole API (`RATE_LIMIT_MAX`, default 300 / 15 min)                                                                                                            | ✅                                                                                                                                         |
| Stricter limiter on auth endpoints and `/admin` (`AUTH_RATE_LIMIT_MAX`, default 20 / 15 min)                                                                                               | ✅                                                                                                                                         |
| Per-account login lockout (`ACCOUNT_LOCK_THRESHOLD`/`ACCOUNT_LOCK_MINUTES`, default 5 / 15 min)                                                                                            | ✅                                                                                                                                         |
| `POST /transfers` behind the sensitive limiter + requires `Idempotency-Key`                                                                                                                | ✅                                                                                                                                         |
| **`POST /quotes` and `POST /recipients` are only under the global limiter** — each `POST /quotes` calls the Wise quote API, so 300/15 min/IP × unlimited IPs is a cost/quota-abuse vector  | 🟡 add a dedicated moderate limiter (tighter than global, looser than auth) before enabling Wise                                           |
| Rate-limit store is **in-memory** (`express-rate-limit` default) — per-instance, resets on restart; multi-instance ⇒ effective limit = N × configured                                      | 🟡 **Blocking for multi-instance production**: move to a shared store (Redis) — already tracked as "Redis-backed rate limit/session cache" |
| `trust proxy` handling: `TRUST_PROXY` (default off). If set, must match exactly one proxy hop or `X-Forwarded-For` spoofing bypasses IP limits; the limiter's proxy validation is disabled | 🟡 document the exact proxy topology; set `TRUST_PROXY` deliberately                                                                       |
| Wise-side: our own back-pressure so a burst doesn't trip Wise's limits (HTTP client already backs off on `429` with `Retry-After`)                                                         | ✅ client; 🟡 no global concurrency cap                                                                                                    |

### 2.10 Fraud controls — ❌ (design + implement before real money)

Current controls: verified-email gate on all money endpoints; per-transfer
amount limits (`DEFAULT_TRANSFER_LIMITS`: min £1, max £25,000 — **hard-coded**,
move to config/DB); backend-authoritative fee/rate/status; three-layer
idempotency; one-transfer-per-quote (migration `0011`, added during the security
audit — **must be wired into `confirm-transfer` and deployed**).

Still required:

- [ ] KYC / identity verification before the first transfer (not built — explicit
      deferral). No real money without it.
- [ ] Sanctions / PEP / watchlist screening of sender and recipient.
- [ ] Velocity limits: per-user daily / weekly / monthly caps; new-account
      cooldown; recipient-add cooldown; max active recipients.
- [ ] Anomaly rules: sudden amount escalation, many recipients, structuring
      (repeated just-under-limit sends), device / IP / geo signals.
- [ ] Manual-review queue and hold state for flagged transfers (the state
      machine currently has no "on hold" state — add one deliberately or hold
      at `created` before submit).
- [ ] Configurable per-corridor limits and cutoffs.
- [ ] SAR / regulatory reporting workflow.
- [ ] Chargeback / recall / `bounced_back` / `charged_back` handling runbook
      (the states are mapped; the operational response is not defined).
- [ ] Confirm the AML/CFT programme owner and that AlmaPay (not only Wise) meets
      its obligations as the customer-facing party.

### 2.11 Webhook security — 🟡

| Item                                                                                                                                                                                                          | State                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /webhooks/wise` mounted before the JSON parser; raw body used for verification                                                                                                                          | ✅                                                                                                                                                                                                                                                                               |
| `X-Signature-SHA256` verified (RSA-SHA256, base64) against Wise's public key; bad signature ⇒ `401`                                                                                                           | ✅ (`RsaWiseWebhookVerifier`)                                                                                                                                                                                                                                                    |
| Verified-but-unhandled event ⇒ `200` (so Wise stops retrying); test notifications acknowledged, not applied                                                                                                   | ✅                                                                                                                                                                                                                                                                               |
| Delivery de-duplication (`webhook_events` unique `(provider, dedupe_key)`)                                                                                                                                    | ✅                                                                                                                                                                                                                                                                               |
| **De-dupe key is `X-Delivery-Id` (an unauthenticated header) when present**, hash of the body only as fallback. A replay of one captured, validly-signed body with a rotated `X-Delivery-Id` is re-processed. | 🟡 **fix before go-live**: key the de-dupe on `sha256(rawBody)` (authenticated content). Impact today is limited by the forward-only, status-idempotent state machine, but it defeats the stated replay protection. (Identified in the in-progress security audit; fix drafted.) |
| Handler runs inside the request, fast (indexed lookups + one update)                                                                                                                                          | ✅                                                                                                                                                                                                                                                                               |
| Forward-only reconciliation — out-of-order / backward transitions ignored, never error                                                                                                                        | ✅ (`apply-wise-transfer-update`)                                                                                                                                                                                                                                                |
| Webhook endpoint on its own rate-limit budget                                                                                                                                                                 | ✅                                                                                                                                                                                                                                                                               |
| Production webhook key set explicitly (see G2)                                                                                                                                                                | ❌                                                                                                                                                                                                                                                                               |
| No timestamp/nonce in Wise's scheme ⇒ rely on body-hash de-dupe + state machine; documented                                                                                                                   | 🟡 document the residual risk                                                                                                                                                                                                                                                    |
| Payload stored in `webhook_events.payload` — confirm it carries no data that violates the retention/PII policy                                                                                                | 🟡 review                                                                                                                                                                                                                                                                        |
| Alert on signature-verification failures and on webhook backlog                                                                                                                                               | ❌                                                                                                                                                                                                                                                                               |

### 2.12 Disaster recovery — ❌

- [ ] Documented RPO / RTO targets, agreed with the business.
- [ ] Database PITR tested (see §2.4); failover / read-replica promotion
      procedure.
- [ ] Infrastructure reproducible from code (IaC) — **none exists yet**; a
      region loss currently means a manual rebuild.
- [ ] Secrets recoverable independently of the primary environment.
- [ ] Wise outage playbook: send-money endpoints already fail to `503`; define
      customer messaging, queue-and-retry vs. hard-stop, and reconciliation on
      recovery.
- [ ] "Stuck transfer" recovery: a transfer that fails mid-`submitToWise`
      (after the AlmaPay row exists, before/after the Wise transfer) — today the
      idempotency fast-path returns the stranded row without resuming
      submission. Define detection (alert on `created` age) and a safe
      re-drive / manual-completion procedure.
- [ ] Reconciliation job: AlmaPay transfers vs. Wise transfers vs. float
      movements, run on a schedule, discrepancies alerted.
- [ ] DR test scheduled (at least annually) and results recorded.

### 2.13 Incident response — ❌

- [ ] On-call rota and escalation path.
- [ ] Severity definitions (SEV1 = money moved incorrectly / data breach / total
      outage).
- [ ] Runbooks: credential compromise (rotate `JWT_SECRET` → all sessions
      invalid on next check; rotate Wise creds; rotate SCA key), suspected
      fraud, Wise outage, DB outage, webhook key mismatch, mass login-failure /
      credential-stuffing, data-subject request, data breach (incl. regulator
      notification timelines).
- [ ] "Kill switch": a config flag to stop accepting new transfers without a
      full deploy (`WISE_ENABLED=false` stops submission but still creates
      records — add an explicit `SEND_MONEY_ENABLED` gate at the route).
- [ ] Post-incident review template; blameless process.
- [ ] Contact list: Wise partner support, cloud provider, DPO, legal, regulator.
- [ ] Comms templates (status page, customer email).

### 2.14 Dependency updates — 🟡

| Item                                                                                                                          | State                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Backend runtime deps are few and current: `express@5`, `pg@8`, `jose@6`, `zod@4`, `express-rate-limit@8`, `@node-rs/argon2@2` | ✅                                                                                  |
| `npm audit --omit=dev`                                                                                                        | ✅ 0 vulnerabilities today                                                          |
| Lockfile committed (`backend/package-lock.json`, `mobile/pubspec.lock`)                                                       | ✅                                                                                  |
| Mobile deps: `flutter_secure_storage@11`, `http@1.6`                                                                          | ✅ (`flutter pub outdated` shows transitive minor updates available — not blocking) |
| Automated dependency updates (Dependabot / Renovate) + `npm audit` / `flutter pub outdated` gate in CI                        | ❌ no CI                                                                            |
| Node runtime pinned (`.nvmrc`, `engines: node >=22.11`) and base image patched on a schedule                                  | 🟡 pin an exact patch in the deploy image; schedule rebuilds                        |
| SBOM generated per release                                                                                                    | ❌                                                                                  |
| Policy for reacting to advisories (SLA by severity)                                                                           | ❌                                                                                  |

### 2.15 Privacy / security configuration — 🟡

| Item                                                                                                                                                                                                           | State                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers on every response (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP default-src 'none'`, `COOP`/`CORP: same-origin`, `Permissions-Policy`, `Cache-Control: no-store`) | ✅ (`security-headers.ts`)                                                                                                                         |
| `x-powered-by` disabled                                                                                                                                                                                        | ✅                                                                                                                                                 |
| No CORS (mobile-only API)                                                                                                                                                                                      | ✅                                                                                                                                                 |
| HSTS in production (`max-age=31536000; includeSubDomains`)                                                                                                                                                     | ✅ — consider adding `preload` once the apex + subdomains are HTTPS-only                                                                           |
| HTTPS enforced at the app in production **only when `TRUST_PROXY` is set**                                                                                                                                     | 🟡 ensure the LB/proxy terminates TLS and sets `X-Forwarded-Proto`, and that `TRUST_PROXY=true` in prod, or HTTPS is not enforced at the app layer |
| Passwords: Argon2id (`@node-rs/argon2`), NIST-style length policy, small weak-list, rehash-on-login                                                                                                            | ✅ — add a breached-password (HIBP range) check before go-live (deferred)                                                                          |
| Access tokens: HS256 JWT, 15-min TTL, `sid` claim, session + account re-checked in the DB on **every** request (immediate revocation)                                                                          | ✅                                                                                                                                                 |
| Refresh tokens: opaque 256-bit, SHA-256 at rest, rotate-on-use, family reuse-detection                                                                                                                         | ✅ — concurrent-refresh can fork a session family (compare-and-swap fix recommended); low exploitability                                           |
| Recipient bank details (account number, sort code, IBAN) stored **without application-level field encryption** (relies on at-rest disk encryption)                                                             | 🟡 for a payments product, add envelope encryption for these columns before holding real customer data                                             |
| DB connection TLS not enforced by the pool (`pg.Pool` with a bare connection string)                                                                                                                           | 🟡 require `sslmode=verify-full` (or platform-managed private networking) in production `DATABASE_URL`                                             |
| Postgres row-level security                                                                                                                                                                                    | N/A today — all access is application-scoped (`WHERE user_id = $1`); RLS is optional defence-in-depth                                              |
| `JWT_SECRET` production-strength + not the example placeholder (G3)                                                                                                                                            | ❌                                                                                                                                                 |
| Privacy: DPIA, records of processing, data-retention schedule, data-subject-request process, sub-processor list (Wise, cloud, email, log/APM vendors), UK GDPR lawful basis                                    | ❌                                                                                                                                                 |
| Penetration test by an external party before go-live                                                                                                                                                           | ❌                                                                                                                                                 |
| Complete the in-progress **security audit** (`docs/security/…`) and close all High findings (JWT placeholder guard, one-transfer-per-quote enforcement, webhook body-hash de-dupe)                             | 🟡 in progress                                                                                                                                     |

### 2.16 Environment separation — 🟡

| Item                                                                                                                                              | State                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Three environments documented as fully separate (`docs/development/environments.md`)                                                              | ✅                                                                                                                     |
| Separate database per environment, never pointed at real data from dev/test                                                                       | ✅ policy stated                                                                                                       |
| Separate Wise account/credentials per environment                                                                                                 | ✅ policy; ❌ prod not provisioned                                                                                     |
| Config from the secrets manager for staging/production; `.env` only for local dev                                                                 | ✅ policy; ❌ no platform                                                                                              |
| **`NODE_ENV` must be `production` in prod** (defaults to `development`) (G4)                                                                      | ❌ add a gate                                                                                                          |
| **Production Wise host refused unless `NODE_ENV=production`** (G1)                                                                                | ❌ add the check                                                                                                       |
| Staging must run `NODE_ENV=production` (for hardening + to suppress reset-link logging) while pointing at the Wise **sandbox** and a synthetic DB | 🟡 make this explicit in the staging config                                                                            |
| No shared secrets, keys, or JWT secret across environments                                                                                        | 🟡 enforce at provisioning                                                                                             |
| Distinct mobile bundle ids / signing per flavour so a staging build can't talk to prod and vice-versa                                             | 🟡 currently one `applicationId` (`com.almapay.almapay`) and one bundle id for all flavours — add per-flavour suffixes |

### 2.17 CI/CD — ❌

- **No CI/CD exists** (no `.github/workflows`, no `.gitlab-ci.yml`, no pipeline
  config).
- [ ] CI on every PR: `npm run typecheck`, `npm run lint`, `npm run format:check`,
      `npm test` (unit + integration against an ephemeral Postgres),
      `npm audit`; `flutter analyze`, `flutter test`.
- [ ] Secret scanning (gitleaks) blocking.
- [ ] SAST (CodeQL / semgrep) on backend + mobile.
- [ ] Build artifacts: backend container image (repro, pinned base, non-root,
      minimal); mobile release builds via `--dart-define=ALMAPAY_ENV=…`.
- [ ] Image signing + provenance (SLSA), image vulnerability scan.
- [ ] CD: promote the same artifact dev → staging → prod; manual approval gate
      for prod; migrations run as an explicit, gated pipeline step (not on boot);
      automatic rollback on failed health checks.
- [ ] Deploy provenance recorded (who, what commit, when) and linked to the
      audit trail.
- [ ] Branch protection, required reviews, signed commits.

### 2.18 Database migrations — 🟡

| Item                                                                                                                                                                        | State                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain-SQL, versioned `NNNN_name.sql`, `-- migrate:up` / `-- migrate:down`, applied in order, each in its own transaction, checksum-tracked (`schema_migrations`)            | ✅ (`migrator.ts`, ADR 0006)                                                                                                                                                                                     |
| Migrations **not** run on boot — explicit `npm run db:migrate`                                                                                                              | ✅ (good for prod control)                                                                                                                                                                                       |
| `db:status` shows applied/pending                                                                                                                                           | ✅                                                                                                                                                                                                               |
| Down migrations exist and are non-destructive where possible; `0010` down remaps history rows with triggers suspended and collapses `refunded → failed` (lossy, documented) | ✅ round-trip tested locally                                                                                                                                                                                     |
| Migration set is **frozen before the first production apply**                                                                                                               | ❌ — `0010_send_money.sql` was reworked during this session and `0011_one_transfer_per_quote.sql` was just added; re-review and freeze. Checksums are enforced, so an edit after a shared-env apply is rejected. |
| Migrations reviewed for lock impact on a populated table (e.g. `CREATE UNIQUE INDEX` in `0011` takes a lock — use `CONCURRENTLY` outside a txn for large tables)            | 🟡 review before prod; tables are empty now                                                                                                                                                                      |
| Forward-fix policy for a bad migration in prod (never edit an applied file)                                                                                                 | 🟡 document                                                                                                                                                                                                      |
| Pre-migration DB snapshot as a pipeline step                                                                                                                                | ❌                                                                                                                                                                                                               |
| Migration runbook: dry-run on a prod-shaped copy, expected duration, abort criteria                                                                                         | ❌                                                                                                                                                                                                               |

### 2.19 Rollback procedures — ❌

- [ ] Application rollback: redeploy the previous image; document that a rollback
      across a migration boundary needs the down migration applied first (and
      that some downs are lossy — `0010`).
- [ ] Migration rollback: `npm run db:rollback` reverts one migration; test each
      down on a prod-shaped copy; know which are safe to reverse with data
      present.
- [ ] Decision tree: when to roll back vs. forward-fix (money already moved ⇒
      forward-fix + reconcile, never blind rollback).
- [ ] Feature-flag / kill-switch path to disable send-money without a deploy.
- [ ] Post-rollback verification checklist (health, a synthetic transaction on
      sandbox, audit continuity).
- [ ] Communance: who authorises a prod rollback.

---

## 3. Mobile — iOS release configuration — 🟡 / ❌

| Item                                                                                                                                           | State                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| No secrets in the app; only backend base URL + display name                                                                                    | ✅ verified                                                     |
| App Transport Security: no `NSAllowsArbitraryLoads`, no ATS exceptions (default TLS enforcement)                                               | ✅                                                              |
| No custom URL schemes / universal links declared (no deep-link attack surface today)                                                           | ✅ (deep links are an explicit deferral)                        |
| Tokens in Keychain, `first_unlock_this_device`, not synced to iCloud, not restored to a new device                                             | ✅ (`SecureTokenStore`)                                         |
| Production build uses `--dart-define=ALMAPAY_ENV=production`; **build fails / refuses if env is `development` in a release build**             | ❌ add a guard in `main()` (release mode ⇒ non-development env) |
| Real backend hostname wired (replace `api.almapay.example`)                                                                                    | ❌                                                              |
| Distribution signing: App Store provisioning profile + distribution cert in the CI keychain, not a developer's laptop                          | ❌                                                              |
| Bundle id per flavour (staging ≠ production)                                                                                                   | ❌ single bundle id                                             |
| `flutter build ipa` with `--obfuscate --split-debug-info`; symbols uploaded to the crash reporter                                              | ❌ (`DART_OBFUSCATION=false`)                                   |
| Privacy manifest (`PrivacyInfo.xcprivacy`) + App Store privacy questionnaire (data collected: email, financial account info; purpose; linkage) | ❌                                                              |
| Jailbreak / debugger checks and screenshot-obscuring for the transfer screens (decide; not required)                                           | ❌ decision needed                                              |
| Certificate pinning to the AlmaPay backend (defence in depth for a payments app)                                                               | ❌ decision needed                                              |
| Minimum iOS version set deliberately; tested on that version                                                                                   | 🟡                                                              |
| `flutter analyze` clean                                                                                                                        | ✅                                                              |

## 4. Mobile — Android release configuration — 🟡 / ❌

| Item                                                                                                                                                                                                                                 | State                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No secrets in the app                                                                                                                                                                                                                | ✅ verified                                                                                                                                       |
| `INTERNET` permission only in `debug`/`profile` manifests; `main` manifest has no dangerous permissions                                                                                                                              | ✅                                                                                                                                                |
| No exported components beyond the launcher activity; no deep-link intent filters                                                                                                                                                     | ✅                                                                                                                                                |
| Tokens via `flutter_secure_storage` (Keystore-backed EncryptedSharedPreferences)                                                                                                                                                     | ✅ — set `AndroidOptions(encryptedSharedPreferences: true)` explicitly and review `resetOnError`                                                  |
| **`android:allowBackup` not set ⇒ defaults to `true`** — app data can be pulled via `adb backup` on some devices; add `android:allowBackup="false"` and `android:dataExtractionRules` / `fullBackupContent` excluding secure storage | ❌                                                                                                                                                |
| **Release build is signed with the debug keystore** (`signingConfig = signingConfigs.getByName("debug")`)                                                                                                                            | ❌ **Blocking** — create a real upload keystore, store it + passwords in CI secrets, wire `key.properties` (git-ignored), enable Play App Signing |
| `minifyEnabled` / `shrinkResources` + R8, with `--obfuscate --split-debug-info`                                                                                                                                                      | ❌                                                                                                                                                |
| `applicationId` per flavour (staging ≠ production); real ID chosen (currently `com.almapay.almapay`, TODO in gradle)                                                                                                                 | ❌                                                                                                                                                |
| Production build uses `--dart-define=ALMAPAY_ENV=production`; release build refuses `development` env                                                                                                                                | ❌ add guard in `main()`                                                                                                                          |
| `network_security_config.xml`: no cleartext in production (modern default is already `false`); pin if pinning is adopted                                                                                                             | 🟡 add an explicit config to be safe and to scope the dev `10.0.2.2` cleartext exception to debug only                                            |
| `targetSdk` current; tested on `minSdk`                                                                                                                                                                                              | 🟡 (inherits Flutter defaults)                                                                                                                    |
| Play Data Safety form (email, financial info) + privacy policy URL                                                                                                                                                                   | ❌                                                                                                                                                |
| Crash/ANR reporting wired; symbol upload                                                                                                                                                                                             | ❌                                                                                                                                                |
| `flutter analyze` clean                                                                                                                                                                                                              | ✅                                                                                                                                                |

---

## 5. Database migration + deploy runbook (to be written) — ❌

Minimum contents:

1. Freeze and tag the migration set; peer-review every `up`/`down`.
2. Snapshot / confirm PITR marker.
3. Dry-run migrations on a restored copy of production; record duration and lock
   behaviour.
4. Maintenance window / online strategy decided per migration.
5. Apply via the gated pipeline step (`npm run db:migrate`), not on boot.
6. Verify `db:status` shows the expected head; run smoke checks and one
   sandbox synthetic transaction.
7. Rollback criteria and the exact `db:rollback` steps (noting lossy downs).

---

## 6. Rollback procedure (to be written) — ❌

See §2.19. Must exist and be rehearsed before go-live.

---

## 7. Blocking items — must be closed before real-money transfers

| #   | Item                                                                                                                                            | Section              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| B1  | Wise production onboarding approved; production credentials, profile id, webhook subscription, funding process in place                         | §2.1                 |
| B2  | Confirm mTLS / SCA-signing requirement with Wise; provision keys in a secrets manager if required                                               | §2.2                 |
| B3  | `JWT_SECRET`: reject the `.env.example` placeholder / low-entropy values when `NODE_ENV=production`; generate a strong per-env secret (G3)      | §1.2, §2.3           |
| B4  | Tie Wise production host to `NODE_ENV=production`; refuse the mix otherwise (G1)                                                                | §1.1                 |
| B5  | Require `WISE_WEBHOOK_PUBLIC_KEY` (and SCA key if used) explicitly for a non-sandbox host — no fallback to the bundled sandbox key (G2)         | §1.1, §2.11          |
| B6  | Enforce `NODE_ENV=production` in the production deployment (G4)                                                                                 | §1.2, §2.16          |
| B7  | Real transactional-email provider wired (email verification gates money movement) (G5)                                                          | §1.2                 |
| B8  | Webhook de-duplication keyed on the authenticated body hash, not `X-Delivery-Id`                                                                | §2.11                |
| B9  | One-transfer-per-quote enforced in `confirm-transfer` + migration `0011` applied (prevents a regenerated-idempotency-key retry double-charging) | §2.10                |
| B10 | Shared (Redis) rate-limit + session cache before running more than one backend instance                                                         | §2.9                 |
| B11 | Database: automated backups + a **tested** restore; PITR; retention                                                                             | §2.4                 |
| B12 | Monitoring + paging alerts for the money path, `/readyz`, DB, Wise, webhooks                                                                    | §2.5, §2.6           |
| B13 | CI/CD pipeline: tests + lint + audit + secret scan gating merges; gated deploy; migrations as a pipeline step                                   | §2.17                |
| B14 | Fraud / AML: KYC before first transfer, sanctions screening, velocity limits, manual-review hold state                                          | §2.10                |
| B15 | Android release signing with a real keystore + Play App Signing                                                                                 | §4                   |
| B16 | Mobile: real production backend hostname; release builds refuse the `development` env; per-flavour ids                                          | §3, §4               |
| B17 | DR + incident-response runbooks, kill switch (`SEND_MONEY_ENABLED`), reconciliation job                                                         | §2.12, §2.13         |
| B18 | External penetration test; close the in-progress security audit's High findings                                                                 | §2.15                |
| B19 | Privacy: DPIA, retention schedule, data-subject-request process, sub-processor list, store-privacy forms                                        | §2.15, §3, §4        |
| B20 | DB connection TLS (`sslmode=verify-full`) and field-level encryption for recipient bank details                                                 | §2.15                |
| B21 | Freeze the migration set; write + rehearse the migration and rollback runbooks                                                                  | §2.18, §2.19, §5, §6 |

---

## 8. Go-live gate

Real-money transfers may be enabled only when:

1. Every Blocking item (B1–B21) is closed, with evidence linked here.
2. The security audit is complete and all Critical/High findings are fixed and
   re-tested.
3. An external penetration test has been completed and its findings triaged.
4. A staging soak (Wise **sandbox**, `NODE_ENV=production`) has run the full
   flow — quote → recipient → confirm → fund → webhook → completed, plus
   failure, cancellation, refund and duplicate paths — for an agreed period
   with monitoring and alerting proven.
5. DR restore and application/migration rollback have been rehearsed.
6. The AML/compliance owner has signed off KYC, screening and reporting.
7. Named sign-off: Engineering, Security, Compliance/Legal, Product.

Until then: keep `WISE_ENABLED=false` (and add `SEND_MONEY_ENABLED=false`). The
send-money endpoints return `503`; no customer funds can move.
