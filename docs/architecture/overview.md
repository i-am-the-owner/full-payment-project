# Architecture overview

## Goal

A professional, secure, maintainable fintech application for international money
transfers, starting with UK → Kenya (GBP → KES) and designed to extend to further
corridors and currencies.

## High-level shape

```
┌──────────────────┐        HTTPS / REST         ┌──────────────────────┐
│  Flutter app     │  ───────────────────────▶   │  AaminPay backend     │
│  (Android / iOS) │                             │  (Node.js + TS)      │
│                  │  ◀───────────────────────   │                      │
└──────────────────┘        JSON responses       └──────────┬───────────┘
                                                            │  server-side only
                                                 ┌──────────┴───────────┐
                                                 │  PostgreSQL          │  (schema defined)
                                                 │  Wise Platform API   │  (sandbox integrated)
                                                 └──────────────────────┘
```

The mobile app is a **thin client**. It renders state and collects input. Every
value that matters financially — fees, exchange-rate displays, transfer amounts,
transfer status — is computed and owned by the backend. The app never talks to
Wise, a database, or any privileged system directly.

## Backend layering (clean architecture)

Dependencies point inwards. Outer layers may depend on inner layers, never the
reverse.

| Layer                | Responsibility                                                                                                | May depend on           |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `domain/`            | Business types and rules. Pure; no I/O, no framework.                                                         | (nothing)               |
| `application/`       | Use cases orchestrating the domain. Dependencies injected as interfaces.                                      | `domain`                |
| `infrastructure/`    | Concrete adapters: `database/` (PostgreSQL pool + migrations), `auth/` (JWT), `wise/` (Wise Platform client). | `domain`, `application` |
| `interfaces/http/`   | Express controllers, routes, middleware. Translates HTTP ⇄ use cases.                                         | `application`, `domain` |
| `config/`, `shared/` | Environment parsing, typed config, structured logging, error hierarchy.                                       | (leaf utilities)        |

`container.ts` is the composition root: it constructs the object graph once at
startup so the rest of the code depends on interfaces, not construction details.

## Mobile layering

Feature-first. Each feature under `lib/features/<name>/` is a vertical slice with
`domain/` (entities, repository interfaces, use cases), `data/` (repository
implementations, data sources, DTOs) and `presentation/` (widgets, pages, state).
Cross-cutting concerns live in `lib/app/` (shell + environment) and `lib/shared/`.

Platform-specific behaviour is isolated behind Flutter abstractions so the app
stays portable across Android and iOS and ready for App Store / Play distribution.

## What is deliberately NOT here yet

The following are explicitly deferred to later, separately-reviewed milestones:

- MFA / step-up authentication, breached-password checks, real email delivery,
  user-facing session management (auth foundations landed in Milestone 5 — see
  [ADR 0008](adr/0008-authentication.md))
- MFA / step-up authentication for high-value transfers, transfer scheduling,
  multiple corridors, mobile-money payouts through Wise

## Related decisions

- [ADR 0001 – Record architecture decisions](adr/0001-record-architecture-decisions.md)
- [ADR 0002 – Monorepo layout](adr/0002-monorepo-layout.md)
- [ADR 0003 – Backend runtime and tooling](adr/0003-backend-runtime-and-tooling.md)
- [ADR 0004 – Backend logging](adr/0004-backend-logging.md)
- [ADR 0005 – Mobile architecture](adr/0005-mobile-architecture.md)
- [ADR 0006 – Database and migrations](adr/0006-database-and-migrations.md)
- [ADR 0007 – Backend API foundation](adr/0007-api-foundation.md)
- [ADR 0008 – Authentication architecture](adr/0008-authentication.md)
- [ADR 0009 – Wise Platform integration](adr/0009-wise-integration.md)
- [ADR 0010 – Send-money flow](adr/0010-send-money-flow.md)
