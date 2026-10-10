# Transfer statuses

AaminPay has **one** internal transfer status enum. Every payout provider's own
statuses are mapped onto it inside that provider's adapter
(`backend/src/infrastructure/providers/<provider>/`); nothing else in the
backend, the API or the apps ever sees a provider's status vocabulary.

Source of truth in code: `backend/src/domain/payout/transfer-status.ts`. The
mapping tables below are asserted by
`backend/test/unit/infrastructure/providers/status-mapping.test.ts` — change the
code, the test and this file together.

## The internal enum

| Status           | Meaning                                                                         | Customer-facing label (mobile) |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| `DRAFT`          | AaminPay's record exists; the provider has not confirmed a transfer yet.         | Preparing                      |
| `AWAITING_FUNDS` | The provider created the transfer and is waiting to be paid by the customer.    | Waiting for your money         |
| `PROCESSING`     | The provider has the funds and is executing the payout.                         | Processing                     |
| `SENT`           | The provider has paid out; the money is on its way to the recipient.            | Sent                           |
| `COMPLETED`      | The provider confirmed delivery to the recipient.                               | Delivered                      |
| `CANCELLED`      | Cancelled before it was funded. Terminal.                                       | Cancelled                      |
| `REFUNDED`       | The money went back to the sender. Terminal.                                    | Refunded                       |
| `FAILED`         | Rejected, bounced back or charged back. Can still be corrected by the provider. | Failed                         |

A provider status that is not in a mapping table maps to nothing: the transfer's
status is left unchanged and the event is recorded as `unmapped_status`. A status
is never guessed.

## Provider mappings

### Mock (`PAYOUT_PROVIDER=mock`)

| Mock status       | Internal status  |
| ----------------- | ---------------- |
| `pending_funding` | `AWAITING_FUNDS` |
| `funded`          | `PROCESSING`     |
| `paid_out`        | `SENT`           |
| `delivered`       | `COMPLETED`      |
| `cancelled`       | `CANCELLED`      |
| `returned`        | `REFUNDED`       |
| `rejected`        | `FAILED`         |

The dev endpoint `POST /dev/mock/transfers/:id/advance` walks
`pending_funding → funded → paid_out → delivered`, or jumps to a status given in
the body, and delivers a signed webhook for each step.

### Wise (`PAYOUT_PROVIDER=wise`)

| Wise transfer state                 | Internal status                       |
| ----------------------------------- | ------------------------------------- |
| `incoming_payment_waiting`          | `AWAITING_FUNDS`                      |
| `incoming_payment_initiated`        | `PROCESSING`                          |
| `processing`                        | `PROCESSING`                          |
| `funds_converted`                   | `PROCESSING`                          |
| `outgoing_payment_sent`             | `SENT`                                |
| `bounced_back`                      | `FAILED`                              |
| `charged_back`                      | `FAILED`                              |
| `cancelled`                         | `CANCELLED`                           |
| `funds_refunded`                    | `REFUNDED`                            |
| `unknown` (or any state not listed) | not mapped (status unchanged; logged) |

Wise has no "delivered" state. `outgoing_payment_sent` is its last success state
and means Wise has paid out, so a Wise transfer ends at `SENT` and never reaches
`COMPLETED`. Whether to show `SENT` as final for Wise, or to complete it after a
set time, is an open product decision.

### Airwallex (`PAYOUT_PROVIDER=airwallex`)

Transfer statuses for Airwallex API version 2025-06-30 or later (the adapter
sends `x-api-version`, default `2026-08-21`). Source: Airwallex docs, "Transfer
statuses".

| Airwallex transfer status | Internal status               | Note                                                                                                                                             |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IN_APPROVAL`             | `AWAITING_FUNDS`              | Approval workflow only (transfers submitted for approval in the Airwallex web app).                                                              |
| `APPROVAL_RECALLED`       | `AWAITING_FUNDS`              | Approval workflow only.                                                                                                                          |
| `APPROVAL_REJECTED`       | `AWAITING_FUNDS`              | Approval workflow only.                                                                                                                          |
| `APPROVAL_BLOCKED`        | `AWAITING_FUNDS`              | Approval workflow only.                                                                                                                          |
| `SCHEDULED`               | `AWAITING_FUNDS`              | Scheduled for its transfer date.                                                                                                                 |
| `OVERDUE`                 | `AWAITING_FUNDS`              | Not funded on or after the transfer date.                                                                                                        |
| `PROCESSING`              | `PROCESSING`                  |                                                                                                                                                  |
| `SENT`                    | `SENT`                        | Sent from Airwallex.                                                                                                                             |
| `PAID`                    | `COMPLETED`                   | Processed by the banking partner. Airwallex notes it can still fail later, which the state machine allows (`COMPLETED → FAILED`).                |
| `FAILED`                  | `FAILED`                      |                                                                                                                                                  |
| `CANCELLED`               | `CANCELLED`                   | Airwallex also cancels a failed transfer automatically; `FAILED → CANCELLED` is not an allowed transition here, so that transfer stays `FAILED`. |
| anything else             | not mapped (status unchanged) |                                                                                                                                                  |

Only `payout.transfer.<status>` webhooks change a status. Funding events
(`payout.transfer.funding.*`) and account events are ignored.

Connected account status → customer verification status:

| Airwallex account status                  | Customer status |
| ----------------------------------------- | --------------- |
| `ACTIVE`                                  | `VERIFIED`      |
| `CREATED`, `SUBMITTED`, `ACTION_REQUIRED` | `PENDING`       |
| `SUSPENDED`                               | `REJECTED`      |
| `DORMANT`, `CLOSED`, anything else        | `NEEDS_RELINK`  |

### Currencycloud

Not built: its adapter is a stub that throws `NotImplemented`, so it has no
mapping yet. See [`CURRENCYCLOUD.md`](CURRENCYCLOUD.md). The mapping must be
written from Currencycloud's official documentation when the adapter is built.

## Allowed transitions

The state machine lives in the database (`transfer_status_transitions`, enforced
by a trigger) and is mirrored in `TRANSFER_TRANSITIONS`; an integration test
checks that the two are identical.

| From                    | To                                            | Needs provider evidence |
| ----------------------- | --------------------------------------------- | ----------------------- |
| `DRAFT`                 | `AWAITING_FUNDS`, `PROCESSING`                | yes                     |
| `DRAFT`                 | `FAILED`, `CANCELLED`                         | no                      |
| `AWAITING_FUNDS`        | `PROCESSING`, `SENT`, `COMPLETED`             | yes                     |
| `AWAITING_FUNDS`        | `FAILED`, `CANCELLED`                         | no                      |
| `PROCESSING`            | `SENT`, `COMPLETED`, `REFUNDED`, `CANCELLED`  | yes                     |
| `PROCESSING`            | `FAILED`                                      | no                      |
| `SENT`                  | `COMPLETED`, `REFUNDED`, `FAILED`             | yes                     |
| `COMPLETED`             | `REFUNDED`, `FAILED`                          | yes                     |
| `FAILED`                | `PROCESSING`, `SENT`, `COMPLETED`, `REFUNDED` | yes                     |
| `CANCELLED`, `REFUNDED` | none (terminal)                               | —                       |

`AWAITING_FUNDS → SENT/COMPLETED` exists so a missed or out-of-order intermediate
webhook does not strand a transfer.

## Who may change a status

- **AaminPay on its own authority** can only fail a transfer (a definitive
  provider rejection) or cancel it (the customer asked, and the provider agreed).
- **Every other status** says what the provider did with the money and needs
  _provider evidence_: a signature-verified webhook (`provider_webhook`), a
  lookup of the transfer at the provider (`provider_lookup`), or the provider's
  response to a call we made (`provider_response`).
- **Correcting a `FAILED` transfer** (a provider sometimes reports a late
  success) is possible only with provider evidence. No customer or admin
  endpoint can do it, and a direct database `UPDATE` without evidence is
  rejected by the trigger. Each correction is written to the audit log as
  `transfer.status_corrected_by_provider` with the old status, the new status,
  the provider, the provider's status and the evidence source.

Every status a transfer enters is also appended to `transfer_events` (append-only)
with its `source`:

| `source`            | Meaning                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `WEBHOOK`           | A signature-verified provider webhook. Provider evidence.                                |
| `POLL`              | A lookup of the transfer at the provider. Provider evidence.                             |
| `PROVIDER_RESPONSE` | The provider's answer to a call we made (e.g. creating the transfer). Provider evidence. |
| `USER`              | The customer asked for it (a cancellation).                                              |
| `ADMIN`             | Reserved. No admin path exists that changes a status.                                    |
| `SYSTEM`            | AaminPay itself: creating the record, or recording a definitive rejection.                |

## What is never marked failed

A provider call that gets no usable answer (a timeout, a 5xx, an unreadable
response) does not fail the transfer. It stays `DRAFT` (creation unconfirmed) or
`AWAITING_FUNDS` (funding unconfirmed), an audit entry
`transfer.outcome_unconfirmed` is written, and a retry with the same
`Idempotency-Key` continues the same transfer under the same provider key.

## Customer verification status

Stored per customer and provider in `provider_links.kyc_status`.

| Status                    | Meaning                                                                                                                       | Customer sees                     | Can send?                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| (no link) / `UNVERIFIED`  | Identity check not started.                                                                                                   | Verify your identity              | No (403 `CUSTOMER_NOT_VERIFIED`) |
| `PENDING`                 | Started; the provider has not decided.                                                                                        | Verification in progress          | No                               |
| `VERIFIED`                | The provider verified the customer.                                                                                           | Verified – you can send money     | Yes                              |
| `REJECTED`                | The provider refused.                                                                                                         | Couldn't verify – contact support | No                               |
| `REJECTED_PENDING_REVIEW` | The provider verified someone whose name or date of birth differs from our profile. Set by AaminPay; cleared only by a person. | Couldn't verify – contact support | No                               |
| `NEEDS_RELINK`            | The provider no longer accepts the customer's connection or tokens.                                                           | Please reconnect your account     | No (403 `NEEDS_RELINK`)          |

Who may change it: only the backend, from provider data (the onboarding
callback, a status lookup, or a provider call rejecting the customer's tokens).
No API accepts a status from a customer or an admin. AaminPay can only make a
status stricter (`REJECTED_PENDING_REVIEW`), never grant `VERIFIED`.

## How statuses change

A status only ever changes on the provider's say-so (`docs/api/README.md`, "Status updates"):

- **Forward only.** A provider event is applied only if the step is allowed by the transitions above **and** the event
  is not older than the newest webhook already applied to that transfer (the provider's own timestamp is used:
  `data.occurred_at` for Wise, `created_at` for Airwallex). An event that fails either test is **not applied** but is
  still written to `transfer_events` with `applied = false` and a reason (`out_of_order`, `invalid_transition`). The
  customer-facing timeline lists applied events only.
- **Sources** on `transfer_events`: `WEBHOOK` (signed webhook), `POLL` (the 15-minute safety-net poll),
  `PROVIDER_RESPONSE` (the answer to a call we made), `USER` (a cancellation), `SYSTEM` (a definitive rejection).
- **Customer verification** events (`customer.status_changed`) update `provider_links` in the same way, ordered by the
  provider's timestamp. A link held for review (`REJECTED_PENDING_REVIEW`) is never released by an event, and
  `VERIFIED` is not accepted until the provider-verified identity has been compared with the customer's profile.
  Documented customer events: Wise `kyc-reviews#state-change` (`PASSED` -> `VERIFIED`, `WAITING_CUSTOMER_INPUT` ->
  `PENDING`; other states are left unchanged); Airwallex `account.*` (see the account table above).

### What the customer is told

| Status entered                               | Email                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AWAITING_FUNDS`                             | none                                                                                     |
| `PROCESSING` (from `AWAITING_FUNDS`/`DRAFT`) | "[Provider] has received your payment"                                                   |
| `SENT`                                       | "Your [amount] is on its way to [recipient]"                                             |
| `COMPLETED`                                  | "[Recipient] has received [amount]"                                                      |
| `CANCELLED`                                  | "Your transfer to [recipient] was cancelled" (and any money paid is returned)            |
| `REFUNDED`                                   | "Your money has been sent back to you"                                                   |
| `FAILED`                                     | "We could not deliver your transfer": the money is not lost, the provider will return it |

A transfer that fails or is refunded after the provider received the customer's money also raises an admin alert.
