# Project brief: [App name]

## What we are building
A consumer money transfer app (web + [iOS/Android]) for people in the UK to send money to bank accounts in any country and currency our payout provider supports.
Company: [Company name], registered in the UK. We do NOT hold a financial licence.
Target volume: about USD 3 million per month within the first year.

## Business model and regulation (must never be broken)
- We are an unlicensed platform. A licensed payout provider (Wise Platform, Airwallex or Currencycloud) is the regulated party.
- The provider does customer KYC/verification (or we do it to their standard if they require it). We never mark a customer as verified ourselves.
- We NEVER hold customer money. Customers pay the provider directly (bank transfer to the provider, or the customer's own balance at the provider). There is no wallet or balance owned by us.
- Every transfer is created on behalf of a verified customer, using that customer's own provider account or connected account.

## Architecture rules
- Provider-neutral: all provider calls go through one PayoutProvider interface. App code never imports a provider SDK or URL directly.
- Providers are chosen by config (PAYOUT_PROVIDER=mock|wise|airwallex|currencycloud). A mock provider must always work, so the app runs with no external accounts.
- Frontend never calls a provider API. Only our backend does.
- Countries, currencies and recipient bank fields are never hard-coded. They come from the provider at runtime (dynamic forms).
- We store a local copy of quotes used, transfers (with status history) and recipients (summary only) so history screens never call the provider.
- Status updates come from provider webhooks, verified by signature, processed idempotently.

## Money safety rules
- Amounts are stored as integers in minor units (e.g. pence) or as decimal strings, never floats.
- Every transfer has our own UUID idempotency key, created once and reused on every retry.
- A transfer can only be created from a valid, unexpired quote.
- Never retry a request that may have created a transfer without first checking whether it exists.

## Security rules
- Secrets only from environment variables / secret manager. Never in code, logs, git or the frontend.
- Provider tokens encrypted at rest. Access tokens never stored long term.
- Log no full bank details, ID documents or tokens.
- TLS 1.2+; mTLS where the provider requires it.

## Environments
- Development uses sandbox credentials only. No production keys exist in this repository.

## How to work
- Before changing code, read the relevant files and explain the plan in 3-6 bullets.
- If an official provider API detail is unclear, read the provider's official docs (docs.wise.com, airwallex.com/docs, developer.currencycloud.com) rather than guessing. If still unclear, stop and ask me.
- Keep changes small and focused on the current prompt. Do not refactor unrelated code.
- Run the tests and linters after each change. Finish every task with: what changed, files touched, how to test it, and which acceptance criteria pass or fail.
