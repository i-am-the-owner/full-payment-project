# ADR 0011 – Provider-neutral payout layer

- Status: accepted
- Date: 2026-10-03
- Supersedes parts of: ADR 0009 (Wise integration), ADR 0010 (send-money flow)

## Context

AaminPay is an unlicensed platform; a licensed payout provider is the regulated
party. The first choice is Wise Platform, with Airwallex as a backup, so the app
must not depend on any one provider. Before this change the use cases, the
domain model and the schema were written directly against Wise, there was no way
to run the app without Wise credentials, and recipients' bank details were
stored locally.

## Decision

1. **One interface.** `PayoutProvider` (`application/payout/`) is the only seam
   to a provider. It speaks AaminPay's own types (`domain/payout/`); a provider's
   response shape never leaves its adapter.
2. **Selection by config.** `PAYOUT_PROVIDER=mock|wise|airwallex|currencycloud`,
   default `mock`. Missing provider variables fail startup. The mock is refused
   in production.
3. **Everything provider-specific in one folder.** `infrastructure/providers/`.
   Only the composition root and the dev-only mock route import from it.
4. **A complete mock.** In-process, deterministic, no credentials: currencies,
   30-minute quotes, per-currency recipient forms, idempotency, HMAC-signed
   webhooks, and a dev endpoint to advance a transfer.
5. **One status enum.** `DRAFT, AWAITING_FUNDS, PROCESSING, SENT, COMPLETED,
CANCELLED, REFUNDED, FAILED`, mapped per provider (docs/STATUSES.md).
6. **Provider evidence.** A status that describes what the provider did with the
   money – and any move out of `FAILED` – can only be applied with provider
   evidence (webhook, lookup or API response). This is enforced by the types,
   by a single use case, and by the database trigger via a transaction-local
   setting. Corrections are audited.
7. **Typed errors.** Adapters translate failures into a fixed set
   (`RouteNotSupported`, `QuoteExpired`, `ValidationFailed`, `InsufficientFunds`,
   `ScaRequired`, `CustomerNotVerified`, `NeedsRelink`, `ProviderUnavailable`,
   `Duplicate`, plus `ProviderRejected` and `NotImplemented`).
   `ProviderUnavailable.outcomeUnknown` separates "nothing happened" from "we do
   not know", which decides whether a transfer may be marked failed.
8. **Runtime data, summary storage.** Currencies and recipient/transfer forms
   come from the provider at runtime. Recipients are created at the provider and
   only a summary is stored. History reads never call the provider.
9. **Per-customer accounts.** Every provider call carries the customer's
   `ProviderCustomerLink`. The Wise adapter uses it as the Wise profile id; there
   is no shared business profile in configuration any more.

## Consequences

- The app runs end to end with no external account.
- The Wise adapter keeps what existed but cannot be used until customer
  onboarding, currencies, forms and pay-in instructions are built for it.
- AaminPay's own per-corridor fee (`fee_rules`) is no longer applied: the quote
  shows the provider's fee only. Whether and how AaminPay charges a fee is open.
- The `countries` and `corridors` tables are no longer used by the send-money
  flow; they are left in place.
- Mock quotes, recipients and transfers are held in memory and are lost when the
  backend restarts.
- API statuses changed from lower-case Wise-derived names to the new enum, and
  the recipient API changed from fixed bank fields to provider forms.
