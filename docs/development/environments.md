# Environments

AlmaPay uses three fully separate environments. Configuration, credentials, data
stores and (later) Wise accounts are never shared between them.

| Environment              | Purpose                                               | Wise                                          | Data                                           |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `development`            | Local development on a contributor machine.           | Wise Sandbox (later)                          | Synthetic/mock only. Never real customer data. |
| `staging` (test/sandbox) | Shared pre-production for integration testing and QA. | Wise Sandbox (later)                          | Synthetic only.                                |
| `production`             | Live service.                                         | Wise production (after approval + onboarding) | Real customer data, minimised and protected.   |

## Backend

Configuration is read from the process environment and validated at startup
(`src/config/env.ts`). Keys are documented in `backend/.env.example`.

| Source of values                                         | Environment             |
| -------------------------------------------------------- | ----------------------- |
| `backend/.env` (git-ignored), copied from `.env.example` | `development`           |
| Deployment platform secrets manager                      | `staging`, `production` |

`NODE_ENV` is one of `development` \| `test` \| `production`. Automated tests run
with `NODE_ENV=test`.

`DATABASE_URL` (PostgreSQL connection string) is used now by the migration CLI.
A separate database per environment; never share one, and never point
development or test at a database holding real customer data. See
[`../database/README.md`](../database/README.md).

Secrets added in later milestones: `WISE_API_BASE_URL`, `WISE_API_TOKEN`,
`WISE_WEBHOOK_PUBLIC_KEY`. All backend-only, never shipped to the mobile app.

## Mobile

The environment is selected at **build time**:

```bash
flutter run   --dart-define=ALMAPAY_ENV=development     # default if omitted
flutter build --dart-define=ALMAPAY_ENV=staging
flutter build --dart-define=ALMAPAY_ENV=production
```

`lib/app/environment/` maps this to an `AppConfig` containing only non-sensitive
values (backend base URL, display name). There is no runtime environment
switching and no secret material in any flavour.

The `*.almapay.example` backend hostnames in `staging`/`production` config are
placeholders until the environments are provisioned.

## Wise (future)

Per the security rules: Wise Sandbox is used for all integration work before any
production integration, and no real money or real customer information is used in
the sandbox. Production Wise access is contingent on business approval and
onboarding.
