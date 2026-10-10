# Go-live readiness

**Verdict: NOT READY, but nothing left to fix is a code problem.** Everything that could be built and tested without a
real provider or an outside account is done (2026-10-04). What remains needs you or a third party: provider
credentials and a signed test plan, a real email account, the lawyer's text and regulatory advice, hosting, a
penetration test, CI's first run, a device test of the app, and decisions (A-12, lost-2FA, limits, launch plan).
Nothing here has run against a real provider, a real email service or a real production environment.

Status key: **PASS** = done and evidenced here. **OPEN** = not done; the "Needs" column says what closes it, and who.
Written 2026-10-04. Sources: [`AUDIT.md`](AUDIT.md), [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md), [`TESTING.md`](TESTING.md),
[`docs/operations/deployment.md`](docs/operations/deployment.md), [`docs/operations/backups.md`](docs/operations/backups.md).

## 1. Readiness checklist

| #   | Item                            | Status          | Evidence / what is missing                                                                                                                                                                                                                                                                                                                                                                                                                     | Needs (owner)                                                                            |
| --- | ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Audit items                     | **OPEN**        | AUDIT.md: every MEDIUM item is now FIXED (A-22, A-24, A-25, A-27 to A-29 closed 2026-10-04) and the LOW items that were small and safe. Left: **A-12** (no customer web app: needs your decision where it lives), A-35 (contact form delivery not wired), A-37 (one unused method kept on purpose), A-39 (mobile secure-storage upgrade skipped: needs a device), A-40 (no commits yet: I only commit when you ask).                           | You: decide A-12, the contact-form destination, and when to make the first commit        |
| 2   | Security review items           | **OPEN**        | SECURITY_REVIEW.md: no critical item open. Now FIXED in code: O-02 shared rate limits, O-03 admin 2FA and console, O-04 recovery codes. Built but needing you: O-01 email adapters (no account), O-05 pinning (off until a domain exists). Still open: O-06 secret manager, O-13 TLS/WAF/log retention, O-15 privacy sign-off, O-16 mTLS against real Wise, O-17 penetration test, O-18 simultaneous-limit race (low).                         | You: email account, hosting, tester, compliance; a support procedure for lost 2FA        |
| 3   | Tests green in CI               | **OPEN**        | **PASS locally**: backend 715 tests (unit and integration on real Postgres), coverage lines 96.8% / branches 88.8% / functions 94.8% with enforced thresholds; 8 Playwright browser tests of the admin console (desktop and 375px); mobile 115; web 30; lint, types, format and builds clean. `.github/workflows/ci.yml` (now also runs Playwright and a docker compose smoke job) **has never run**: the repository has no commits or remote. | You: push to GitHub, confirm the first run is green                                      |
| 4   | Webhooks verified               | **OPEN**        | Signature verification, dedupe, out-of-order handling, replay and processing are tested with the mock provider and Wise/Airwallex fixtures (bad signature = 401, nothing changes). Never tested against a real provider's webhooks.                                                                                                                                                                                                            | Provider sandbox/production keys; run the provider test plan (section 5)                 |
| 5   | Idempotency proven              | **PASS** (mock) | Tests: double-click Confirm creates one transfer here and at the provider; a provider timeout during createTransfer never double-creates (the create is repeated with the same id; Wise has no lookup by customer transaction id); one transfer per quote; duplicate webhooks do nothing; notifications once per transfer and kind. Re-prove against the real provider in the test plan.                                                       | Provider sandbox                                                                         |
| 6   | Limits set                      | **OPEN**        | Per-transfer, daily (rolling 24 h) and monthly (rolling 30 d) limits are enforced and tested, **configurable with `TRANSFER_LIMIT_CURRENCY`, `_PER_TRANSFER`, `_PER_DAY`, `_PER_MONTH`** (start-up refuses numbers that do not grow with the period), and shown on the admin dashboard. Defaults GBP 5,000 / 10,000 / 25,000 are placeholders. Known gap O-18: two simultaneous confirms can exceed a limit by one transfer.                   | You: approve the numbers (section 6 proposes launch values)                              |
| 7   | Monitoring live                 | **OPEN**        | Built: JSON logs with request ids, `/healthz` `/readyz`, worker health and heartbeat, Sentry-compatible error hook (`SENTRY_DSN`, untested against live Sentry), admin alerts and dashboard, `scripts/uptime-check.sh` and an optional scheduled GitHub check. Not live: no environment exists, no log aggregation, no alert routing or on-call.                                                                                               | You: hosting, Sentry/log/uptime accounts, on-call rota                                   |
| 8   | Backups tested                  | **OPEN**        | **PASS locally**: backup then restore into an empty database, consistency checks passed, restore into a non-empty database refused (2026-10-03). No production database exists to back up.                                                                                                                                                                                                                                                     | Managed DB with PITR; a restore test on a real backup                                    |
| 9   | Legal pages final               | **OPEN**        | Terms, Privacy, Cookies exist as drafts; every placeholder is marked `TODO-LEGAL` (`grep -rn TODO-LEGAL web/src mobile/lib`: 16 places). Footer and pay screen state that payments are provided by the provider and that AlmaPay does not hold customer funds (provider name is the placeholder on the website).                                                                                                                               | You: lawyer's final text; replace every `TODO-LEGAL`; the count must reach 0             |
| 10  | Provider production credentials | **OPEN**        | None received. No production key exists in this repository. Wise adapter `oauth_partner` mode and Airwallex are written but untested against the providers.                                                                                                                                                                                                                                                                                    | You: provider contract, partner credentials, webhook keys, mTLS certificates if required |
| 11  | Provider test plan signed off   | **OPEN**        | Proposed plan in section 5. Not run, not signed.                                                                                                                                                                                                                                                                                                                                                                                               | You and the provider                                                                     |
| 12  | Limited launch plan             | **OPEN**        | Proposed plan in section 6. Not approved.                                                                                                                                                                                                                                                                                                                                                                                                      | You                                                                                      |
| 13  | Rollback plan                   | **OPEN**        | Written in section 7. Never rehearsed.                                                                                                                                                                                                                                                                                                                                                                                                         | Rehearse on staging                                                                      |
| 14  | Admin panel                     | **PASS**        | Admin role in the database, two-step sign-in required (re-checked on every request), every request audited before it runs (fails closed), read-only except suspend/unsuspend, resolving alerts and the pause switch; tests prove an admin cannot change an amount or status; browser-tested. Recovery codes work for admins too. Needs a network restriction in front of it (item 15).                                                         |                                                                                          |
| 15  | Hosting, TLS, WAF, secrets      | **OPEN**        | Container image, compose stack, health checks, graceful shutdown and per-environment config exist. Chosen platform, TLS termination, WAF/DDoS, managed Postgres with TLS, secret manager, network rules, IP-restricting `/admin-console` and `/api/v1/admin`: none exist.                                                                                                                                                                      | You: platform and accounts                                                               |
| 16  | Email delivery                  | **OPEN**        | `EMAIL_PROVIDER=postmark                                                                                                                                                                                                                                                                                                                                                                                                                       | resend                                                                                   | ses`adapters and templates (email code, verification link, password reset, waiting for payment, funds received, delivered, returned, ID check result) are built and tested against fake HTTP (SES signing is checked against AWS's published test vector). **Nothing has been sent through a real service**, and the "waiting for payment" email is not triggered yet (the app already shows the details; sending it at creation is a product decision). Production refuses to start on`EMAIL_PROVIDER=log`. Steps in section 9. | You: choose a provider, create the account, verify the domain (SPF/DKIM/DMARC) |
| 17  | Regulatory position             | **OPEN**        | AlmaPay is an unlicensed platform and the provider is the regulated party. Needs written confirmation from a UK financial-regulation lawyer that this model (including how the customer is described and who contracts with them) is acceptable, and the provider's agreement to it.                                                                                                                                                           | You: legal advice                                                                        |
| 18  | Penetration test                | **OPEN**        | None done (O-17).                                                                                                                                                                                                                                                                                                                                                                                                                              | You: external tester                                                                     |
| 19  | Data protection                 | **OPEN**        | Export/erase script exists. Retention periods, DPIA, ICO registration, privacy notice (O-15).                                                                                                                                                                                                                                                                                                                                                  | You: compliance                                                                          |
| 20  | Mobile release                  | **OPEN**        | Built: release signing from a git-ignored `key.properties` (refused without it), a release build refuses to run without `ALMAPAY_ENV` or with a placeholder/non-https API URL, certificate pinning behind a flag (tested against a real local TLS server). **Not run:** the Gradle change (no Android SDK here), any store build, any device. Steps in section 8.                                                                              | You: keystore, store accounts, a production domain, a device test                        |
| 23  | 2FA recovery codes              | **PASS** (code) | Ten one-time codes, shown once, stored as hashes, usable at sign-in for customers and admins, regenerable, audited; tested. **The support procedure for someone with no phone and no codes is yours to decide.**                                                                                                                                                                                                                               | You: lost-2FA procedure                                                                  |
| 22  | Shared rate limits              | **PASS**        | Counted in Postgres, so the limit holds across instances (tested with two instances); webhooks have their own budget. A WAF is still advisable for volumetric attacks (item 15).                                                                                                                                                                                                                                                               |                                                                                          |
| 21  | Pause new transfers             | **PASS**        | Admin switch (2FA session plus a fresh authenticator code, audited) stops new quotes and new transfers with a clear message to customers (`503 TRANSFERS_PAUSED`, `GET /availability`); transfers in progress, replays, funding, cancelling and history continue. Tested over HTTP and in the browser.                                                                                                                                         |                                                                                          |

## 2. Switching from sandbox to production (environment variables only)

Never edit code. Do staging first with the **sandbox** values (`APP_ENV=staging` refuses live keys), then production.
Templates: [`backend/config/env/`](backend/config/env/). A start-up check lists every problem it finds.

Common to production (all providers): `NODE_ENV=production`, `APP_ENV=production`, real `JWT_SECRET` and
`ENCRYPTION_KEY` from the secret manager, `DATABASE_URL` with `?sslmode=verify-full`, `PUBLIC_API_URL` (https),
`TRUST_PROXY=true`, `CORS_ALLOWED_ORIGINS` (https only), `PROVIDER_REDIRECT_HOSTS` (the provider's identity-page hosts),
`BACKGROUND_JOBS_ENABLED=false` on API processes plus a separate worker, `SENTRY_DSN`, `TRANSFER_LIMIT_*` as approved,
and **remove** `ALLOW_NON_PROD_PROVIDER`, `MOCK_WEBHOOK_SECRET`, `DEV_LOG_MAIL_LINKS`.

**Wise** (partner OAuth; a personal token is refused on production hosts)

| Variable                                        | Sandbox                         | Production                                                                                                                                       |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PAYOUT_PROVIDER`                               | `wise`                          | `wise`                                                                                                                                           |
| `WISE_AUTH_MODE`                                | `personal_token`                | `oauth_partner`                                                                                                                                  |
| `WISE_API_TOKEN`                                | sandbox token                   | unset                                                                                                                                            |
| `WISE_CLIENT_ID`, `WISE_CLIENT_SECRET`          | sandbox partner values or unset | production partner values                                                                                                                        |
| `WISE_AUTHORIZE_URL`, `WISE_OAUTH_REDIRECT_URI` | sandbox                         | from Wise onboarding; redirect registered with Wise                                                                                              |
| `WISE_API_BASE_URL`                             | `https://api.wise-sandbox.com`  | `https://api.wise.com`, or `https://api-mtls.transferwise.com` with `PROVIDER_MTLS_CERT_PATH`, `PROVIDER_MTLS_KEY_PATH`, `PROVIDER_MTLS_CA_PATH` |
| `WISE_ALLOW_PRODUCTION`                         | unset                           | `true`                                                                                                                                           |
| `WISE_WEBHOOK_PUBLIC_KEY`                       | bundled sandbox key             | Wise's production webhook key (required)                                                                                                         |
| `WISE_SCA_PRIVATE_KEY`                          | optional                        | its public half registered with Wise                                                                                                             |

Then register the webhook subscription once (`scripts/setup-webhooks.ts`, needs `WISE_CLIENT_KEY`) pointing at
`https://<api>/webhooks/wise`.

**Airwallex**

| Variable                                                                                                 | Sandbox                                       | Production                  |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------- |
| `PAYOUT_PROVIDER`                                                                                        | `airwallex`                                   | `airwallex`                 |
| `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`                                                               | sandbox                                       | production                  |
| `AIRWALLEX_BASE_URL`                                                                                     | `https://api.sandbox.airwallex.com` (default) | `https://api.airwallex.com` |
| `AIRWALLEX_ALLOW_PRODUCTION`                                                                             | unset                                         | `true`                      |
| `AIRWALLEX_WEBHOOK_SECRET`                                                                               | sandbox                                       | production (required)       |
| `AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID`, `AIRWALLEX_ONBOARDING_RETURN_URL`, `AIRWALLEX_ONBOARDING_ERROR_URL` | sandbox                                       | production                  |

Airwallex hosted onboarding supports business accounts only (docs/PROVIDERS.md): confirm consumer support before use.

**Currencycloud**: a documented stub; every operation throws NotImplemented. It cannot go live.

**Verify after switching** (before any customer): `GET /readyz` is ready; the start-up log shows
`payout.provider.selected` with the live provider and no `config.non_prod_provider_allowed` warning; send a real
low-value transfer from a staff account through the whole flow (section 5); check webhooks arrive and the transfer
reaches its final state; check the admin dashboard and audit log show it.

## 3. Runbook

First, always: note the time, the transfer id or reference, and the customer's `requestId` (shown in API errors).
Look in the admin console (**Reports**) and the logs (`requestId`, `transferId`).

**The provider API is down.** Signs: `PROVIDER_UNAVAILABLE` (503) to customers, `transfer.poll.failed` and `job`
failures in logs, provider status page.

1. Confirm on the provider's status page and with a direct request from outside.
2. Customers cannot start or confirm transfers; money already with the provider is safe. A create that timed out is
   never retried blindly: it is repeated with the same id, so it cannot duplicate.
3. Do not edit anything. Optionally tell customers (status message on the site or app).
4. When it is back, the worker retries failed jobs and the 15-minute poll corrects any status; check
   **Reports > Stuck for 24h+** and **Open alerts**; resolve alerts once explained.
5. Long outage: **pause new transfers** (admin console, Dashboard, "Pause new transfers": needs your authenticator code; customers then see your message instead of failing on a dead provider). Transfers already in progress are not affected. Resume the same way when the provider is back.

**A webhook stops arriving.** Signs: transfers stay `PROCESSING`/`SENT` past the usual time; no recent rows in
**Reports > Webhook errors** and none in `webhook_events`.

1. The 15-minute poll is the safety net: it fetches status from the provider, so customers still get updates (slower).
2. Check the subscription exists at the provider and points at the right URL; re-register with `scripts/setup-webhooks.ts`.
3. Check the proxy/WAF is not blocking the provider's IPs and that the raw body is passed unchanged.
4. If **Webhook errors** shows `invalid_signature`: the signing key changed or the body is being altered (never disable
   verification). Check `WISE_WEBHOOK_PUBLIC_KEY` / `AIRWALLEX_WEBHOOK_SECRET`.
5. After the fix, use `POST /api/v1/transfers/:id/refresh` (explicit provider lookup) for any transfer still behind.

**A transfer is stuck.** (**Reports > Stuck for 24h+**.)

1. Open the transfer: read the timeline and webhook history. Note the provider status and provider transfer id.
2. Ask the provider for the transfer by that id. Provider says paid out: refresh it (the poll will also do it).
   Provider says waiting for funds: the customer has not paid; remind them with the provider's reference.
   Provider says bounced/failed: the status becomes `FAILED`/`REFUNDED` from provider evidence and an alert is raised.
3. **Never** change a status or amount directly in the database: the database rejects status changes without provider
   evidence, and admins have no write path by design. If AlmaPay's state is wrong, fix it by getting the provider's
   truth in (refresh or webhook replay).
4. No answer from the provider after one business day: raise it with the provider's support, quote the ids, tell the customer.

**A customer reports missing money.**

1. Identify the customer (search users) and the transfer (search transfers by reference, user and date). Verify the
   person's identity before sharing anything.
2. Read the timeline. Money flow is customer to **provider** directly; AlmaPay never holds funds. Where is it?
   - `AWAITING_FUNDS`: the provider has not received their payment: check the reference they used, and the provider's bank details.
   - `PROCESSING` or `SENT`: with the provider or the recipient's bank: ask the provider for the payout reference
     and expected time; share it with the customer.
   - `FAILED` or `REFUNDED`: the provider returns money to the customer's account; give the provider's refund reference and time frame.
   - `COMPLETED` but recipient says not received: ask the provider for proof of payment/bank reference.
3. Record what you did in the ticket (the admin console already audits what you viewed). Escalate to the provider and to
   a director for anything over the agreed amount. Complaints must be handled and acknowledged under the final Terms (Financial Ombudsman route: TODO-LEGAL).
4. If funds really are lost, or the customer reports fraud or an account takeover: suspend the account (admin console),
   which revokes all sessions at once; preserve logs; follow the incident process (below).

**Security incident** (suspected breach or key leak): rotate `JWT_SECRET` (signs everyone out), rotate provider
secrets, rotate `ENCRYPTION_KEY` (bump `ENCRYPTION_KEY_VERSION`, keep the old key to read old data), review the
audit log, tell the provider; UK GDPR breach reporting to the ICO within 72 hours is a legal duty (TODO-LEGAL: who decides).

## 4. What staff can and cannot do

Admins: search, view, suspend/unsuspend, resolve alerts. They cannot create, change, fund, cancel or complete a
transfer or change an amount, a recipient or a status (tests prove it), and every view is in the audit log. Grant
or revoke the role only with `scripts/grant-admin.ts` (audited); a role takes effect only with two-step sign-in on.

## 5. Provider test plan (proposed; not run)

Run on the provider's **sandbox** first, then once on production with staff accounts and small amounts. A person
from the provider and from AlmaPay sign each row.

1. Onboarding: new customer verified by the provider; a rejected customer; a name/date-of-birth mismatch goes to review and is never marked verified by us.
2. Currencies and routes: lists load; GBP to EUR, USD and the launch routes quote; an unsupported route gives "not supported".
3. Quote and recipient: dynamic recipient form for each launch currency; validation errors reach the right field; a quote expires and is refused.
4. Transfer and idempotency: create; double-click creates one; kill the connection mid-create and confirm one transfer exists.
5. Funding: pay by bank transfer with the shown reference; transfer moves to processing; balance funding if offered.
6. Webhooks: every status arrives, signed; replay and out-of-order events are ignored correctly; a tampered body is rejected.
7. Failure paths: bounced-back and refunded transfers show correctly, raise an alert, and the customer is told.
8. Cancel before funding; cancel after funding is refused.
9. Polling: stop webhooks and confirm the 15-minute poll catches up.
10. Limits and suspension: per-transfer, daily and monthly limits block; a suspended customer is blocked at once.
11. Reconciliation: AlmaPay's records match the provider's report for every test transfer (amounts, fees, rates, statuses).
12. Security: no token or bank detail in logs; secrets only from the environment.

## 6. Limited launch plan (proposed; needs your approval)

- **Who:** 10 to 25 invited customers (friends, family, staff), then up to 100. No marketing, no public sign-up (closed list; sign-up country GB only).
- **Routes:** two currency routes at most (one stable corridor you can support in person, for example GBP to EUR, plus one more), chosen with the provider.
- **Limits:** per transfer GBP 250, per day GBP 500, per month GBP 1,500 for the first two weeks (`TRANSFER_LIMIT_*`); raise in steps after clean weeks.
- **Watch:** daily review of the dashboard, **Stuck**, **Failed**, **Webhook errors**, **Identity reviews** and open alerts; a named person on call.
- **Exit criteria to widen:** two weeks with no unexplained stuck transfer, no money discrepancy at reconciliation, all alerts explained, a restore test passed, email delivery working.
- **Stop criteria:** any money discrepancy, repeated webhook failure, a security event, or the provider asking us to pause.

## 7. Rollback plan

- **Code/config:** keep the previous image tag. Redeploy it (API and workers). Migrations are additive and backward compatible with the previous release, so the old code runs on the new schema; do not run `rollback` on a live database unless a migration itself is the fault (and it never drops data tables: see `docs/database`).
- **Pause new transfers:** the admin console switch (no deploy). It leaves everything in progress running; stop the workers only if the data itself is suspect.
- **Bad data:** restore from the latest verified backup into a new instance (docs/operations/backups.md), point `DATABASE_URL` at it, start API then workers; reconcile transfers created after the backup with the provider's records.
- **Compromised secret:** rotate as in the security-incident runbook.
- **Rehearse** each step on staging before launch (item 13).

## 8. What only you can do

Provider contract and credentials; legal text and regulatory advice; hosting accounts, domain and TLS; an email
service; Sentry/logging/uptime accounts and an on-call rota; approving limits and the launch plan; deciding where the
customer web app lives (A-12); commissioning the penetration test; compliance sign-off (retention, DPIA, ICO);
pushing the repository to GitHub so CI runs; app-store accounts and signing.

## 8. Mobile release: signing, environment, certificate pinning

**Signing (Android).** Create a release keystore once and keep it (and its passwords) in a vault: losing it means you
can never update the app. Put `mobile/android/key.properties` (git-ignored) on the build machine:

```
storeFile=/secure/path/almapay-release.jks
storePassword=...
keyAlias=almapay
keyPassword=...
```

A release build without that file is refused. Build:
`flutter build appbundle --release --flavor app --dart-define=ALMAPAY_ENV=production --dart-define=ALMAPAY_API_URL=https://api.<your-domain>`
(the Android build has two flavours: `app` is the real AlmaPay, `demo` is the sample-data demo of [`docs/demo`](docs/demo/README.md), which
the real entry point refuses and which is never signed with the release key).
A release build also refuses to start with no `ALMAPAY_ENV`, as `development`, with the `.example` placeholder host, or
with a non-https URL. **Not yet run:** the Gradle change has never been built (no Android SDK here); do a first build
on a staging domain. iOS signing and store setup are not done.

**Certificate pinning (built, OFF).** Turn it on only once the production domain and certificate exist:

1. Get the SPKI pin of the live certificate and of a **backup key** you generate now and keep offline:
   `openssl s_client -connect api.<domain>:443 -servername api.<domain> </dev/null 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`
   (for the backup key: `openssl pkey -in backup.key -pubout -outform DER | openssl dgst -sha256 -binary | base64`).
2. Build with `--dart-define=ALMAPAY_PIN_CERTS=true --dart-define=ALMAPAY_TLS_PINS=<pin1>,<pin2>`. The app refuses to
   start with the flag on and fewer than two pins or a non-https URL.
3. **Renewal plan (required):** Dart can only see the server's own certificate, so the pin is the leaf KEY. Renew the
   certificate **keeping the same key**, or switch to the backup key and ship an app update that adds the next backup
   pin BEFORE the switch. A mistake locks every installed app out of the API until users update.
4. Test on staging first: with the right pins the app works; change one pin and confirm it cannot connect.

Not covered by pinning: the provider's identity-check WebView, and users behind a corporate proxy (pinning bypasses system
proxies by design). Root/jailbreak detection is not built.

## 9. Email go-live

1. Pick Postmark, Resend or Amazon SES; create the account; verify the sending domain and set SPF, DKIM and DMARC.
2. Set `EMAIL_PROVIDER`, `EMAIL_FROM` and the provider's key (names in `backend/.env.example`). SES: use an IAM role or a
   key allowed `ses:SendEmail` only.
3. On staging, trigger each message (register, reset, a transfer through every status, an identity check) and read it in a
   real mailbox. Check the reset link opens the app screen you expect (`PUBLIC_APP_URL`).
4. Watch for `mail.failed` in the logs: account emails never fail the request, so a broken key is visible only there. Transfer
   notices retry through the job queue.
5. Tell the provider's support you will send transactional email; start with a low volume.

## 10. Staff access recovery

Admins and customers lose a phone. Each person has ten one-time recovery codes (shown once when two-step was turned on, or
after "regenerate"). With neither phone nor codes: an admin with `DATABASE_URL` access removes the role with
`scripts/grant-admin.ts revoke`, the person's identity is re-checked out of band, and they set up two-step again; for a
customer the procedure is yours to define (O-04), and the strongest check is the provider's own identity re-check.
