# AlmaPay

AlmaPay is a UK-based fintech application for international money transfers.

- **Initial corridor:** United Kingdom → Kenya
- **Initial currency pair:** GBP → KES
- **Transfer infrastructure:** a licensed payout provider behind a provider-neutral layer, chosen by `PAYOUT_PROVIDER` (`mock` by default; Wise partly adapted; Airwallex and Currencycloud are stubs)
- **Future:** additional countries and currency pairs

> **Status:** Milestone 7 – the backend-authoritative **send-money flow** over
> the Milestone 6 Wise Sandbox integration: `POST /api/v1/quotes` (provider rate
> + AlmaPay fee), recipients, `POST /api/v1/transfers` (create + submit + fund,
> idempotent), `GET /api/v1/transfers/:id`, cancellation, and webhook-driven
> status reconciliation. The Flutter app never decides a fee, rate or status —
> the backend is the source of truth. No real money, no production credentials.
> See [`docs/architecture/adr/0010-send-money-flow.md`](docs/architecture/adr/0010-send-money-flow.md)
> and [`docs/integrations/wise.md`](docs/integrations/wise.md).

## Repository layout

| Path        | Contents                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `backend/`  | Node.js + TypeScript REST API (Express) and PostgreSQL schema/migrations. |
| `mobile/`   | Flutter application (Android and iOS).                                 |
| `web/`      | Public marketing website (Next.js + TypeScript). No secrets; separate from the app. |
| `docs/`     | Architecture decisions, database schema, security principles, environments. |

Each sub-project owns its own tooling, dependencies and README. There is no shared
build system; the projects are versioned together for coordinated delivery.

## Prerequisites

| Tool       | Version                     | Used by   |
| ---------- | --------------------------- | --------- |
| Node.js    | 22 LTS (see `.nvmrc`)       | `backend` |
| npm        | 10+                         | `backend` |
| PostgreSQL | 14+ (local or Docker)       | `backend` |
| Flutter    | 3.47.x stable (Dart 3.13.x) | `mobile`  |

## Getting started

### Backend

```bash
cd backend
npm install
cp .env.example .env        # set DATABASE_URL and JWT_SECRET; never commit .env
                            # PAYOUT_PROVIDER defaults to `mock`: no provider keys needed

# Start a local PostgreSQL (see docs/database/README.md for the Docker one-liner),
# then apply the schema:
npm run db:migrate

npm run dev                 # starts the API on http://localhost:3000
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

### Mobile

```bash
cd mobile
flutter pub get
flutter run                 # defaults to the development environment
# or target another environment:
flutter run --dart-define=ALMAPAY_ENV=staging
```

The app shows a sign-in / registration flow and stores its session tokens in the
platform keystore (`flutter_secure_storage`). It holds no backend secret — only
the public API base URL.

## Quality gates

Run before every commit.

| Check          | Backend                  | Mobile             |
| -------------- | ------------------------ | ------------------ |
| Format         | `npm run format`         | `dart format .`    |
| Static analysis| `npm run lint`           | `flutter analyze`  |
| Type checking  | `npm run typecheck`      | (part of analyze)  |
| Tests          | `npm test`               | `flutter test`     |

## Security

AlmaPay handles money. Read [`docs/security/security-principles.md`](docs/security/security-principles.md)
before contributing. In short: no secrets in the mobile app, no secrets in git,
all privileged and Wise communication happens server-side, and no transfer is ever
marked successful on the strength of the client alone.
