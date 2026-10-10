# 10. Backend-authoritative send-money flow

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

Milestone 7 builds the customer send-money flow on top of the Milestone 6 Wise
gateway: choose currency and destination, enter an amount, get a backend quote
(provider rate + AlmaPay fee), pick or add a recipient, review, confirm, and
then watch the transfer through to a verified terminal state.

The controlling constraint: **the Flutter app must never decide the final fee,
the final exchange rate, transfer success or failure, or the provider status.**
The backend is the single source of truth; the client only renders what the
backend returns.

## Decisions

### The quote is an immutable server-side resource

`POST /api/v1/quotes` calls `WiseGateway.createQuote`, applies AlmaPay's
configured fee (`fee_rules`, by corridor), and persists a `transfer_quotes` row
with the Wise quote id, the exact provider rate (decimal string), the fee, and an
expiry. The client receives an opaque `quoteId` plus display values. It cannot
send a rate or fee back — confirmation takes only `quoteId` + `recipientId`, and
the backend re-reads the stored quote. An expired quote is rejected; the customer
requests a new one. The `quoted` state from the milestone brief is modelled this
way (a quote resource every transfer references) rather than as a transfer
status.

### Transfer states — only what the Wise integration produces

`created → awaiting_payment → processing → completed`, with `failed` reachable
from every non-terminal state, `cancelled` from `created` / `awaiting_payment`,
and `refunded` from `processing` / `completed` / `failed`. Only `cancelled` and
`refunded` are truly terminal; `completed` and `failed` can still be followed by
a `refunded`/chargeback. The set is enforced by the database
(`transfer_status_transitions` + a trigger), not just application code. Wise
states map in `domain/transfer/transfer-status.ts`; a state we do not recognise
maps to "no AlmaPay meaning" and is ignored, never guessed.

### Confirmation is idempotent at three layers

`POST /api/v1/transfers` requires an `Idempotency-Key` header.

1. A fast lookup by `(user_id, idempotency_key)` returns the existing transfer
   (HTTP 200) before any work.
2. A unique constraint on `(user_id, idempotency_key)` catches a concurrent
   race; the loser re-reads and returns the winner's transfer.
3. Wise dedupes `POST /v1/transfers` on `customerTransactionId` (the AlmaPay
   transfer id), so a retried submission never creates a second Wise transfer.

A duplicate request therefore always returns the original transfer and never
moves money twice. A fresh transfer is 201; a replay is 200.

### Submission failures fail the record, they do not dangle

After the AlmaPay `transfers` row exists, `confirm-transfer` creates the Wise
recipient (lazily, once), creates the Wise transfer, and funds it from the
AlmaPay balance. Any Wise error transitions the transfer to `failed` with a
mapped reason (`create:<code>`, `funding:<code>`) and audits it — the HTTP call
still returns 201 with `status: "failed"` so the client shows a definite
outcome. An SCA challenge on funding leaves the transfer `awaiting_payment` for
manual approval rather than failing it.

### Status is reconciled from the provider, forward-only

`apply-wise-transfer-update` is the single place a Wise state becomes an AlmaPay
state, from either a verified webhook (`POST /webhooks/wise`) or a best-effort
poll on `GET /api/v1/transfers/:id` for a non-settled transfer. It is
forward-only: an out-of-order or backwards transition (the DB trigger rejects it)
is logged and ignored, never surfaced as an error. Webhook deliveries are
deduplicated on `X-Delivery-Id` (or a payload hash) in `webhook_events` so a
Wise retry is processed once. A status change driven by a webhook is recorded
with `actor_type = 'provider_webhook'` in `transfer_status_history`.

### The client cannot compute money

Responses carry the fee, rate and amounts as pre-formatted strings the client
displays verbatim. There is no field the client could use to re-derive them, and
no endpoint accepts a fee or rate. `GET /api/v1/transfers/:id` returns only the
backend-verified status.

## Consequences

- New endpoints: `POST /api/v1/quotes`, `GET|POST /api/v1/recipients`,
  `POST|GET /api/v1/transfers`, `GET /api/v1/transfers/:id`,
  `POST /api/v1/transfers/:id/cancel`. All require a verified email.
- Migration `0010_send_money.sql` reworks the transfer state set to match Wise
  and adds quote/recipient/transfer columns for the provider ids.
- Mobile-money payouts are validated and stored but rejected at confirmation
  (Wise recipient shape not yet confirmed for that rail) — listed as a follow-up.
- Tested end to end with an injected fake `WiseGateway`
  (`test/integration/send-money/`): happy path, duplicate, race, Wise-create
  failure, funding rejection, cancellation, signed webhook to `completed`, and
  unknown-transfer webhook. No live Wise calls.
