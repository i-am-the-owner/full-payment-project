# 1. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

AlmaPay is a financial application with strict security and correctness
requirements. Decisions about structure, tooling and integration approach need to
be traceable: a future contributor (or auditor) should be able to see _why_ a
choice was made, not just _what_ the code does.

## Decision

We keep lightweight Architecture Decision Records (ADRs) in
`docs/architecture/adr/`, one Markdown file per significant decision, numbered
sequentially.

An ADR captures: context, the decision, and the consequences (trade-offs
accepted). ADRs are immutable once `Accepted`. A decision that changes gets a new
ADR that supersedes the old one; the old one is updated only to add a
`Superseded by ADR NNNN` note.

"Significant" means: hard to reverse, affects multiple parts of the system, or
has security/financial implications.

## Consequences

- Small ongoing documentation cost per major decision.
- Onboarding and security review have a single, ordered place to read the
  rationale behind the codebase.
