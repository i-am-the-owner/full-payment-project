# 4. Backend logging: small in-house structured logger

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Core security rule 5: never log passwords, access/refresh tokens, card
information, full identity documents or other sensitive financial data. We need
structured (JSON) logs for aggregation, with a _guarantee_ that sensitive fields
are stripped, and we want to keep the dependency surface small.

## Decision

Implement a small (~100-line) structured logger in `src/shared/logger.ts` with:

- JSON-line output (`time`, `level`, `msg`, plus caller fields).
- Level filtering (`debug` < `info` < `warn` < `error`).
- **Recursive redaction** of keys matching a sensitive-key pattern
  (`password`, `secret`, `token`, `authorization`, `apiKey`, `privateKey`,
  `cardNumber`, `cvv`, `pan`, `iban`, `sortCode`, `accountNumber`, `ssn`, `pin`,
  …), replacing values with `[REDACTED]`.
- Depth limiting and `Error` serialisation.
- `child(bindings)` for request-scoped context (e.g. request id).
- An injectable `write` sink for testability.

We do **not** adopt `pino` / `winston` at this stage.

## Rationale

- The redaction requirement is a hard security control. A small, fully-readable
  implementation is easier to audit and unit-test than a third-party logger's
  redaction configuration.
- Zero runtime dependencies for a component on every code path.

## Consequences

- We own ~100 lines of logging code and its tests.
- No log transports, sampling, or async flushing out of the box. If those become
  necessary, migrate to `pino` behind the existing `Logger` interface — callers
  do not change.
- Redaction is key-name based. Reviewers must still avoid putting secrets into
  _string messages_ or under non-obvious key names.
