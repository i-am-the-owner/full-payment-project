# AaminPay documentation

| Document                                                                   | Purpose                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`architecture/overview.md`](architecture/overview.md)                     | System shape, layering, and how the pieces fit together.                                                                 |
| [`architecture/adr/`](architecture/adr/)                                   | Architecture Decision Records – one file per significant, hard-to-reverse decision.                                      |
| [`api/README.md`](api/README.md)                                           | REST API: versioning, response/error format, auth, endpoints.                                                            |
| [`STATUSES.md`](STATUSES.md)                                               | The one internal transfer status enum, each provider's mapping onto it, allowed transitions and who may make them.       |
| [`PROVIDERS.md`](PROVIDERS.md)                                             | What each payout provider supports, the environment variables each needs, and how to switch `PAYOUT_PROVIDER`.           |
| [`CURRENCYCLOUD.md`](CURRENCYCLOUD.md)                                     | The Currencycloud stub and which Currencycloud API would implement each operation.                                       |
| [`integrations/wise.md`](integrations/wise.md)                             | Wise Platform Sandbox integration: endpoints, auth, SCA, webhooks, idempotency.                                          |
| [`database/schema.md`](database/schema.md)                                 | The v1 PostgreSQL schema, table by table.                                                                                |
| [`database/README.md`](database/README.md)                                 | Running a local database and applying migrations.                                                                        |
| [`security/security-principles.md`](security/security-principles.md)       | Non-negotiable security rules for a money-moving application.                                                            |
| [`security/authentication-review.md`](security/authentication-review.md)   | Auth implementation reviewed against common auth vulnerabilities.                                                        |
| [`development/environments.md`](development/environments.md)               | Development, sandbox/test and production configuration model.                                                            |
| [`operations/production-readiness.md`](operations/production-readiness.md) | Production-readiness checklist and go-live gate. AaminPay is **not** production-ready; real-money transfers are disabled. |

New significant decisions get a new ADR (copy the highest-numbered one as a
template). ADRs are immutable once `Accepted`; supersede rather than edit.
