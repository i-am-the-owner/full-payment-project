# Currencycloud adapter (stub)

`CurrencycloudPayoutProvider` exists so that `PAYOUT_PROVIDER=currencycloud` is a
valid choice and its configuration is checked at startup. It is a **documented
stub**: every operation throws `NotImplemented`, no webhook is accepted, and it
makes no call to the Currencycloud API.

Code: `backend/src/infrastructure/providers/currencycloud/currencycloud-payout-provider.ts`.

This page maps each `PayoutProvider` operation to the Currencycloud API that
would implement it. The endpoint names are taken from the API reference at
<https://developer.currencycloud.com/api-reference/>. Nothing here has been
called or tested; request and response fields must be read from the reference
when the adapter is built.

## Basics

| Topic              | Currencycloud                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosts              | Demo `devapi.currencycloud.com`, production `api.currencycloud.com` (from the Authentication guide).                                                                                                |
| Authentication     | `POST /v2/authenticate/api` with `login_id` and `api_key` returns a token, sent as `X-Auth-Token`. Tokens expire after 30 minutes of inactivity. `POST /v2/authenticate/close_session` retires one. |
| Customer model     | Sub-accounts of our account, each with contacts. Calls are made for a sub-account with the `on_behalf_of` parameter (reference section "Sub-Account Activity (on_behalf_of)").                      |
| Configuration here | `CURRENCYCLOUD_API_BASE_URL`, `CURRENCYCLOUD_LOGIN_ID`, `CURRENCYCLOUD_API_KEY`.                                                                                                                    |

## Operation mapping

| `PayoutProvider` operation   | Currencycloud API                                                                     | Notes                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCapabilities`            | `GET /v2/reference/currencies`                                                        | Capabilities would be assembled from reference data.                                                                                                                                                 |
| `listCurrencies`             | `GET /v2/reference/currencies`                                                        |                                                                                                                                                                                                      |
| `startCustomerOnboarding`    | `POST /v2/accounts/create`, `POST /v2/contacts/create`                                | Creates a sub-account and a contact. The reference shows no hosted KYC page, so this would return `done` or need our own data collection to Currencycloud's standard. To confirm with Currencycloud. |
| `completeCustomerOnboarding` | `GET /v2/accounts/{id}`                                                               | The sub-account id would be the customer reference.                                                                                                                                                  |
| `getCustomerStatus`          | `GET /v2/accounts/{id}`                                                               | From the account's status and `compliance_settings`. The status values need mapping.                                                                                                                 |
| `createQuote`                | `GET /v2/rates/detailed`                                                              | An indicative detailed rate. A firm price exists only once a conversion is created with `POST /v2/conversions/create`.                                                                               |
| `getRecipientForm`           | `GET /v2/reference/beneficiary_required_details`                                      | Returns required fields and validation patterns per currency, bank country and payment type; to convert into `DynamicForm`.                                                                          |
| `createRecipient`            | `POST /v2/beneficiaries/validate`, then `POST /v2/beneficiaries/create`               | Optional account check: `POST /v2/beneficiaries/account_verification`.                                                                                                                               |
| `updateQuoteWithRecipient`   | `GET /v2/payments/quote_payment_fee` or `GET /v2/payments/payment_fees`               | To show the payment fee for the chosen beneficiary.                                                                                                                                                  |
| `getTransferForm`            | `GET /v2/reference/payment_purpose_codes`, `GET /v2/reference/payer_required_details` | Purpose codes and payer details required for the route.                                                                                                                                              |
| `createTransfer`             | `POST /v2/conversions/create`, then `POST /v2/payments/create`                        | Both accept a `unique_request_id`, which would carry our idempotency UUID. `POST /v2/payments/validate` can check first.                                                                             |
| `getFundingInstructions`     | `GET /v2/funding_accounts/find`                                                       | The account details the customer pays into for a currency.                                                                                                                                           |
| `fundTransfer`               | `GET /v2/balances/{currency}`                                                         | Payments are paid from the sub-account balance; there is no separate "fund" call. SCA for API payments exists (`POST /v2/payments/authorise`).                                                       |
| `getTransfer`                | `GET /v2/payments/{id}`                                                               | Also `GET /v2/payments/{id}/tracking_info`.                                                                                                                                                          |
| `cancelTransfer`             | `POST /v2/payments/{id}/delete`                                                       | And `POST /v2/conversions/{id}/cancel` for the conversion.                                                                                                                                           |
| `verifyWebhook`              | Push notifications, HMAC key from `POST /v2/contacts/generate_hmac_key`               | The exact signature scheme must be read from the "Push Notifications / Webhooks" section.                                                                                                            |
| `parseWebhook`               | Push notification payloads                                                            | Payment status values need a mapping table in `STATUSES.md`.                                                                                                                                         |
| Sandbox simulation           | `POST /v2/demo/funding/create`                                                        | Emulates incoming funds in the demo environment.                                                                                                                                                     |

## Open points before building it

- How Currencycloud verifies end customers (KYC) for sub-accounts, and whether a hosted flow exists.
- The full list of payment statuses, for the status mapping.
- Whether a rate can be held for a customer without creating a conversion.
- The webhook signature scheme and retry behaviour.
