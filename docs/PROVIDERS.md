# Payout providers

The backend talks to exactly one licensed payout provider at a time, through the
`PayoutProvider` interface (`backend/src/application/payout/payout-provider.ts`).
Everything provider-specific lives under
`backend/src/infrastructure/providers/`.

## Switching provider

Set one environment variable and restart the backend. No code changes.

```bash
PAYOUT_PROVIDER=mock          # default: no other variable needed
PAYOUT_PROVIDER=wise
PAYOUT_PROVIDER=airwallex
PAYOUT_PROVIDER=currencycloud
```

- Startup fails with a message naming the missing variables if the chosen
  provider is not fully configured.
- A customer's link and verification status are stored per provider
  (`provider_links`). After a switch, each customer has to be onboarded with the
  new provider; their link to the old one is kept.
- Quotes, recipients and unsubmitted transfers belong to the provider that
  created them and cannot be used with another.
- Inbound webhooks are accepted only at `/webhooks/<active provider>`.

## Where each provider stands

|                                 | mock                    | wise                                   | airwallex                                            | currencycloud                      |
| ------------------------------- | ----------------------- | -------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| State                           | Complete, in-process    | Partly adapted                         | Built from the docs, **not run against the sandbox** | Documented stub                    |
| Tested against the real service | n/a                     | No                                     | No (no credentials available)                        | No                                 |
| Allowed in production           | No (refused at startup) | Only with explicit production settings | Only with explicit production settings               | No (nothing implemented)           |
| Customer model                  | Simulated               | The customer's own Wise profile        | One connected account per customer                   | Sub-account per customer (planned) |

## Capabilities

From each provider's `getCapabilities()`. Wise and Currencycloud do not
implement `getCapabilities()` yet, so their columns describe the adapter code.

|                                 | mock                                      | wise            | airwallex                                           | currencycloud   |
| ------------------------------- | ----------------------------------------- | --------------- | --------------------------------------------------- | --------------- |
| Source currencies               | GBP, EUR, USD                             | not implemented | `AIRWALLEX_SOURCE_CURRENCIES` (default GBP)         | not implemented |
| Target currencies               | GBP, EUR, USD, INR, NGN, PHP, MXN         | not implemented | From Airwallex at runtime (beneficiary form schema) | not implemented |
| KYC by redirect to the provider | Yes (dev page `/dev/mock/kyc`, simulated) | not implemented | Yes (hosted flow)                                   | not implemented |
| Funding methods                 | BANK_TRANSFER, BALANCE                    | BALANCE only    | BANK_TRANSFER, BALANCE                              | not implemented |
| Unsupported operations reported | none                                      | —               | Hosted onboarding for INDIVIDUAL accounts           | —               |

## Interface operations

`yes` = implemented. `no-op` = implemented, nothing to do at this provider.
`NotImplemented` = not built yet. `NotSupported` = the provider has no such
operation.

| Operation                    | mock                                                | wise                                          | airwallex                                                               | currencycloud  |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| `getCapabilities`            | yes                                                 | NotImplemented                                | yes                                                                     | NotImplemented |
| `startCustomerOnboarding`    | yes (instant)                                       | NotImplemented                                | yes for BUSINESS accounts; **NotSupported for INDIVIDUAL**              | NotImplemented |
| `completeCustomerOnboarding` | yes                                                 | NotImplemented                                | yes                                                                     | NotImplemented |
| `getCustomerStatus`          | yes                                                 | NotImplemented                                | yes                                                                     | NotImplemented |
| `listCurrencies`             | yes                                                 | NotImplemented                                | yes (cached 24 h)                                                       | NotImplemented |
| `createQuote`                | yes                                                 | yes                                           | yes (fee is always 0: Airwallex prices the fee at transfer creation)    | NotImplemented |
| `getRecipientForm`           | yes                                                 | NotImplemented                                | yes                                                                     | NotImplemented |
| `createRecipient`            | yes                                                 | yes (IBAN or sort code + account number only) | yes                                                                     | NotImplemented |
| `updateQuoteWithRecipient`   | yes                                                 | no-op                                         | no-op                                                                   | NotImplemented |
| `getTransferForm`            | yes                                                 | NotImplemented                                | yes (reason and transfer method)                                        | NotImplemented |
| `createTransfer`             | yes                                                 | yes                                           | yes                                                                     | NotImplemented |
| `getFundingInstructions`     | yes                                                 | NotImplemented                                | yes (customer's own global account and Wallet)                          | NotImplemented |
| `fundTransfer`               | yes                                                 | BALANCE only                                  | yes (reports Airwallex's automatic Wallet funding; it triggers nothing) | NotImplemented |
| `getTransfer`                | yes                                                 | yes                                           | yes                                                                     | NotImplemented |
| `cancelTransfer`             | yes                                                 | yes                                           | yes                                                                     | NotImplemented |
| `verifyWebhook`              | yes (HMAC-SHA256)                                   | yes (RSA-SHA256)                              | yes (HMAC-SHA256 of timestamp + body)                                   | always false   |
| `parseWebhook`               | yes                                                 | yes                                           | yes (payload redacted before storage)                                   | NotImplemented |
| Sandbox status simulation    | Dev endpoint `POST /dev/mock/transfers/:id/advance` | not built                                     | `simulateTransferTransition` (sandbox only)                             | —              |

## Environment variables

All are backend-only. None may reach a client. Placeholders are in
`backend/.env.example`.

### mock

None.

### wise

| Variable                                | Required         | Meaning                                                  |
| --------------------------------------- | ---------------- | -------------------------------------------------------- |
| `WISE_API_TOKEN`                        | one of these two | A pre-issued bearer token.                               |
| `WISE_CLIENT_ID` + `WISE_CLIENT_SECRET` | one of these two | OAuth client credentials from partner onboarding.        |
| `WISE_API_BASE_URL`                     | no               | Defaults to the Wise sandbox.                            |
| `WISE_WEBHOOK_PUBLIC_KEY`               | production only  | Wise's RSA public key (PEM). The sandbox key is bundled. |
| `WISE_SCA_PRIVATE_KEY`                  | no               | RSA private key (PEM) for signing SCA one-time tokens.   |
| `WISE_ALLOW_PRODUCTION`                 | production only  | Must be `true` to use a production host.                 |

### airwallex

| Variable                                                            | Required                                  | Meaning                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `AIRWALLEX_CLIENT_ID`                                               | yes                                       | From the Airwallex web app (Developer > API keys).                               |
| `AIRWALLEX_API_KEY`                                                 | yes                                       | Shown once when the key is created.                                              |
| `AIRWALLEX_BASE_URL`                                                | no                                        | Defaults to the sandbox, `https://api.sandbox.airwallex.com`.                    |
| `AIRWALLEX_WEBHOOK_SECRET`                                          | to receive webhooks; always in production | The secret of the webhook notification URL. Without it every webhook is refused. |
| `AIRWALLEX_API_VERSION`                                             | no                                        | Sent as `x-api-version`. Default `2026-08-21`.                                   |
| `AIRWALLEX_LEGAL_ENTITY_TYPE`                                       | no                                        | `INDIVIDUAL` (default) or `BUSINESS`.                                            |
| `AIRWALLEX_ACCOUNT_COUNTRY`                                         | no                                        | Country new connected accounts are created in. Default `GB`.                     |
| `AIRWALLEX_SOURCE_CURRENCIES`                                       | no                                        | Comma-separated Wallet currencies customers send from. Default `GBP`.            |
| `AIRWALLEX_HOSTED_FLOW_TEMPLATE_ID`                                 | for hosted onboarding                     | Template id provided by Airwallex.                                               |
| `AIRWALLEX_ONBOARDING_RETURN_URL`, `AIRWALLEX_ONBOARDING_ERROR_URL` | no                                        | Where Airwallex sends the customer after the hosted flow.                        |
| `AIRWALLEX_ALLOW_PRODUCTION`                                        | production only                           | Must be `true` to use `https://api.airwallex.com`.                               |

For the opt-in sandbox test only: `AIRWALLEX_TEST_ACCOUNT_ID`, an ACTIVE sandbox
connected account with a funded GBP Wallet.

### currencycloud

| Variable                     | Required | Meaning                  |
| ---------------------------- | -------- | ------------------------ |
| `CURRENCYCLOUD_API_BASE_URL` | yes      | Checked at startup only. |
| `CURRENCYCLOUD_LOGIN_ID`     | yes      | Checked at startup only. |
| `CURRENCYCLOUD_API_KEY`      | yes      | Checked at startup only. |

### All real providers

| Variable                  | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `PAYOUT_HTTP_TIMEOUT_MS`  | Timeout per provider call. Default 15000.                        |
| `PAYOUT_HTTP_MAX_RETRIES` | Retries for safe (idempotent) calls only. Default 3.             |
| `ENCRYPTION_KEY`          | Encrypts stored provider refresh tokens. Required in production. |

## Notes on Airwallex

- **Hosted onboarding is for business accounts only**, according to Airwallex's
  documentation. Individual customers need Airwallex's embedded onboarding
  component (front-end work) or its native API (we collect the documents to
  Airwallex's standard). Neither is built.
- **Creating a connected account asserts that the customer accepted Airwallex's
  terms and data usage.** The app must collect that acceptance before calling
  `POST /api/v1/customer/onboarding/start`.
- **A transfer is paid from the customer's own Airwallex Wallet** as soon as it
  is created (or on its transfer date). AaminPay holds nothing.
- **The quote shows no fee.** Airwallex returns the transfer fee only when the
  transfer is created.
- **Webhook payloads contain the recipient's full bank details.** The adapter
  keeps only ids, the event name and the status; the rest is never stored.
- **Account status events are not handled.** A customer's verification status is
  refreshed when the app calls `GET /api/v1/customer/status`.

See also [`STATUSES.md`](STATUSES.md) for status mappings and
[`CURRENCYCLOUD.md`](CURRENCYCLOUD.md) for the Currencycloud plan.

## Looking a transfer up by idempotency key

`findTransferByIdempotencyKey` is called before any retry of a create whose
outcome is unknown.

| Provider      | How                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mock          | Looks the key up in memory.                                                                                                                                     |
| Airwallex     | `GET /api/v1/transfers?request_id=<key>`.                                                                                                                       |
| Wise          | No documented lookup by `customerTransactionId`: throws `NotSupported`, and the create is re-sent with the same `customerTransactionId`, which Wise dedupes on. |
| Currencycloud | Not implemented (stub).                                                                                                                                         |
