# 2. Single repository with independent sub-projects

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

AaminPay has two deployable artefacts (a Flutter app and a Node.js backend) plus
shared documentation. They are developed by one team and released in a
coordinated way. The two projects share almost no code (different languages,
different runtimes).

## Decision

Use one Git repository with top-level directories:

- `backend/` – Node.js + TypeScript API, with its own `package.json` and tooling.
- `mobile/` – Flutter app, with its own `pubspec.yaml` and tooling.
- `docs/` – cross-cutting documentation.

Do **not** introduce a monorepo build tool (Nx, Turborepo, Melos) or a root
`package.json`. Each sub-project is built and tested independently with its native
toolchain.

## Consequences

- Simple mental model; no monorepo tooling to learn or maintain.
- Coordinated changes (e.g. an API change and its client) land in one commit /
  pull request, keeping history coherent.
- Shared logic, if it ever emerges, needs a deliberate decision (new ADR) rather
  than being assumed.
- CI runs per-project pipelines scoped by path.
