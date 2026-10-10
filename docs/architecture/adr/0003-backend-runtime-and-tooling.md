# 3. Backend runtime and tooling

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

The backend is Node.js + TypeScript + REST + PostgreSQL (PostgreSQL added later).
We want strong typing, small dependency surface, fast feedback, and production
builds that are easy to reason about for security review.

## Decision

### Runtime: TypeScript on Node's native type stripping

Node 22 runs `.ts` files directly by stripping types — no `ts-node`, no bundler,
no transpile step in development. `tsc` is used only for type-checking
(`--noEmit`) and for producing the production `dist/` build.

Consequence: source must use **erasable syntax only**. No `enum`, no
`namespace` with runtime semantics, no constructor parameter properties. This is
enforced by `erasableSyntaxOnly` in `tsconfig.json` and an ESLint rule. String
literal unions replace enums. Relative imports use explicit `.ts` extensions and
are rewritten to `.js` on build (`rewriteRelativeImportExtensions`).

### HTTP framework: Express 5

Mature, minimal, well understood. Express 5 is the current stable major.

### Validation: zod

Used for environment validation now and request-body validation later. One
library covers "validate all input on the backend".

### Testing: Node's built-in test runner (`node --test`)

No Jest / Vitest. `node:test` + `node:assert/strict` cover unit and integration
testing; integration tests run the real Express app on an ephemeral port and call
it with `fetch`. Keeps the dependency surface small.

### Structured logging

A small in-house JSON logger — see
[ADR 0004](0004-backend-logging.md).

### Lint / format

ESLint (type-aware, `typescript-eslint`) + Prettier, wired so they do not fight.

## Dependencies (initial)

| Runtime          | Dev                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `express`, `zod` | `typescript`, `@types/node`, `@types/express`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `globals` |

## Consequences

- Very small runtime dependency tree → smaller attack surface, faster audits.
- Contributors must know the "erasable syntax" constraint; the compiler enforces
  it, so mistakes fail fast.
- If logging/transport needs outgrow the in-house logger, swapping to `pino`
  behind the same interface is a contained change.
