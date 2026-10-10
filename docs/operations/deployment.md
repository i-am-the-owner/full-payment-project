# Deployment

How AlmaPay runs in development, staging and production. Nothing here is a hosting decision: it works on
any container platform (ECS, Kubernetes, Fly, a VM with Docker). Hosting, TLS, the WAF and the managed
database are listed as OPEN in [`../../GO_LIVE.md`](../../GO_LIVE.md).

## Run the whole stack locally

```bash
docker compose up --build          # API_PORT=3010 docker compose up --build   if port 3000 is taken
docker compose logs seed           # demo logins and the demo admin's authenticator secret
```

Starts Postgres, runs the migrations (a one-shot `migrate` service that must finish before anything else), loads
demo data (`seed`: a verified customer, an admin with two-step sign-in, a customer awaiting identity review and ten
transfers in every state), then the API and the job worker, all on the **mock provider**. API
`http://localhost:3000`, health `/healthz`, readiness `/readyz`, admin console `/admin-console/`
(`admin@almapay.test`, the password and a code from the printed secret). Stop with `docker compose down`
(`-v` also deletes the database volume). These values are public and for development only.

## Processes

| Process    | Command                                            | Notes                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API        | `node dist/main.js`                                | Run several behind a load balancer. Set `BACKGROUND_JOBS_ENABLED=false` when workers run separately.                                                                                                                   |
| Worker     | `node dist/worker.js`                              | Webhook processing, notification emails, stuck-transfer poll. Any number may run: jobs are claimed with `SKIP LOCKED`, scheduled tasks are enqueued once per period. Health on `:3001/healthz` (`WORKER_HEALTH_PORT`). |
| Migrations | `node dist/infrastructure/database/cli.js migrate` | A **deploy step**, run once per release before the new API/worker start. Plain SQL, each migration in a transaction, checksummed; never edit an applied one. `rollback` reverts the last.                              |
| Seed       | `node dist/seed.js`                                | Development only; refuses `NODE_ENV=production`.                                                                                                                                                                       |

The image (`backend/Dockerfile`) is multi-stage, runs as a non-root user and has a `HEALTHCHECK`. Build with
`docker build -t almapay-backend ./backend`.

**Graceful shutdown.** On `SIGTERM` the API stops accepting connections and drains; the worker stops claiming jobs,
lets the job in progress finish, then closes the database (a 25 s hard limit, so give the platform a 30 s
termination grace period). A job interrupted anyway is retried: jobs are idempotent.

**Release order.** Deploy migrations first, then workers, then API. Migrations must be backward compatible with the
previous release (add before you use; drop only a release later) so a rolling deploy never breaks the old version.

## Environments

`APP_ENV` says which one this is (`development`, `staging`, `production`). Templates:
[`backend/config/env/`](../../backend/config/env/). Secrets come from the platform's secret manager, never from git.

|                                                                      | development       | staging         | production                                        |
| -------------------------------------------------------------------- | ----------------- | --------------- | ------------------------------------------------- |
| `NODE_ENV`                                                           | `development`     | `production`    | `production`                                      |
| Provider                                                             | mock (or sandbox) | sandbox or mock | live                                              |
| Live provider keys/hosts                                             | refused           | **refused**     | required                                          |
| Mock or sandbox provider                                             | allowed           | allowed         | **refused** unless `ALLOW_NON_PROD_PROVIDER=true` |
| Dev tools, logged mail links                                         | on                | off             | off (start-up refuses)                            |
| HTTPS, HSTS, strict CORS, DB TLS, real `JWT_SECRET`/`ENCRYPTION_KEY` | optional          | required        | required                                          |

Start-up fails with a message naming each problem (`src/config/app-config.ts`,
`src/infrastructure/providers/environment-policy.ts`). `ALLOW_NON_PROD_PROVIDER=true` in production logs a warning
on every start: use it for a dry run, then remove it.

## Health, logs, errors, uptime

- **Probes.** `GET /healthz` liveness (restart if it fails); `GET /readyz` readiness (database reachable; stop sending
  traffic if it fails). Unversioned, no auth. The worker has its own `/healthz`.
- **Logs.** One JSON object per line on stdout/stderr: `time`, `level`, `msg`, `service`, `env`, `appEnv`,
  `requestId` and fields. The `x-request-id` header is accepted (or generated) and returned on every response, and
  is in the `meta.requestId` of every API answer, so a customer's report can be traced. Tokens, bank details, names,
  emails and similar fields are redacted by key. Ship stdout to your log service (retention: see GO_LIVE).
- **Error tracking.** Set `SENTRY_DSN` (Sentry or any compatible endpoint). Unexpected errors (HTTP 500s, crashes,
  unhandled rejections) are sent with the error type, message, stack and request id only, rate-limited to 30 a minute.
  Without a DSN nothing is sent. Not yet tested against a live Sentry project.
- **Uptime.** Point an external monitor at `/healthz` and `/readyz` (not from the same network as the API).
  `scripts/uptime-check.sh <base-url>` does both checks for cron or any command-based monitor, and
  `.github/workflows/uptime.yml` runs it every 15 minutes when the repository variable `HEALTH_URL` is set (a stopgap:
  GitHub schedules are best-effort). Alert on: `/readyz` failing 2 times in a row, any `request.unhandled_error`,
  `worker.heartbeat` missing for 2 minutes, open admin alerts, `webhook` rejections.

## Behaviour switches (no deploy)

- **Pause new transfers:** admin console, Dashboard. Needs the admin's current authenticator code and is audited.
  Customers see the message you set; transfers in progress continue.
- **Rate limits** are shared by all instances (Postgres) unless `RATE_LIMIT_STORE=memory`.
- **Email** is `EMAIL_PROVIDER=log|postmark|resend|ses`; production refuses `log`.
- **Customer limits** are `TRANSFER_LIMIT_*` (a deploy; shown on the admin dashboard).

## Admin access

Admins are not created through the API. Give an existing account the role, have them turn on two-step sign-in in
the app, and sign in again:

```bash
cd backend && node --env-file-if-exists=.env scripts/grant-admin.ts grant --email person@example.com
node --env-file-if-exists=.env scripts/grant-admin.ts revoke --email person@example.com
```

Each change is audited. Restrict `/admin-console/` and `/api/v1/admin/` at the proxy (VPN or IP allow-list) as well:
the application protects them, but a second layer is cheap.
