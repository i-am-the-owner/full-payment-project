# Testing

What is tested, how to run it, and what is not covered. Nothing here touches the
network or a real provider unless a section says "opt-in".

| Kind                    | Where                                                  | Needs                   | Run                        |
| ----------------------- | ------------------------------------------------------ | ----------------------- | -------------------------- |
| Backend unit            | `backend/test/unit`, `backend/src/**/*.test.ts`        | Node 22                 | `npm run test:unit`        |
| Backend integration     | `backend/test/integration`                             | Postgres, mock provider | `npm run test:integration` |
| Backend coverage        | both of the above                                      | Postgres                | `npm run test:coverage`    |
| Provider contract tests | `backend/test/unit/infrastructure/providers/*`         | Node 22                 | part of `test:unit`        |
| Live sandbox (opt-in)   | `backend/test/integration/providers/*-sandbox.test.ts` | sandbox keys            | see below                  |
| App UI / end-to-end     | `mobile/test`                                          | Flutter                 | `flutter test`             |
| Website                 | `web/src`                                              | Node 22                 | `npm test`                 |

## Backend

```bash
cd backend
npm ci
npm run lint && npm run format:check && npx tsc --noEmit
npm run test:unit
```

**Integration tests** use a real Postgres and the mock provider. Start a throwaway database and point
`DATABASE_URL` at it (the harness migrates the database; without `DATABASE_URL` the suites are
skipped, not failed):

```bash
docker run -d --name almapay-pg-test -e POSTGRES_PASSWORD=almapay -e POSTGRES_DB=almapay_test -p 55432:5432 postgres:16
export DATABASE_URL=postgres://postgres:almapay@localhost:55432/almapay_test
npm run test:integration
docker rm -f almapay-pg-test        # when finished
```

They cover: sign-up -> onboarding -> verified; quote -> recipient -> questions -> transfer -> fund -> webhooks ->
COMPLETED; cancel; bounce-back and refund; expired quote; route not supported; validation errors; a provider
timeout during createTransfer (exactly one transfer is created); double-click confirm; limits; duplicate,
out-of-order and badly signed webhooks; polling; and cross-user access to every resource
(`test/integration/security/cross-user-access.test.ts`).

**Coverage:** `npm run test:coverage` runs unit and integration tests together and **fails** if line coverage is
below 90%, branches below 80% or functions below 85% (thresholds in `package.json`). Latest run: 715 tests,
lines 96.78%, branches 88.76%, functions 94.77%.

**Contract tests per provider.** Each real adapter (Wise, Airwallex) is tested against recorded or documented HTTP
responses through a fake transport (`test/support/wise-fakes.ts`, `test/fixtures/`): every operation, every
error status, status mapping, form conversion, webhook signature verification and parsing, and a check that no
token or bank detail reaches a log. Currencycloud is a stub; its test asserts every operation throws
`NotImplemented`.

### Opt-in live sandbox tests

Skipped unless the keys are present, so CI never uses the network. They refuse any host that is not a sandbox.

```bash
# Wise: a SANDBOX personal API token
WISE_API_TOKEN=... node --test test/integration/providers/wise-sandbox.test.ts

# Airwallex: sandbox credentials and an ACTIVE sandbox connected account with a funded GBP wallet
AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... AIRWALLEX_TEST_ACCOUNT_ID=acct_... \
  node --test test/integration/providers/airwallex-sandbox.test.ts
```

Neither has been run by the author (no sandbox keys were available). The Wise test skips its simulate-to-completed
steps with a message when the transfer cannot be funded (a UK/EU personal token cannot fund from balance).

## App (end-to-end UI)

The customer app is the Flutter app in `mobile/`; the website in `web/` is marketing only, so there is no
customer web UI for Playwright to drive. The UI tests are Flutter widget tests that run the real screens and
controller against a fake backend that behaves like the mock provider:

```bash
cd mobile && flutter pub get && flutter analyze && flutter test            # add --coverage for lcov
```

- The full send flow (amount -> recipient -> questions -> review -> pay -> status COMPLETED) runs on a
  **375px phone** and on a **1280px desktop window**; other screen tests run at 375px, where a layout overflow
  fails the test.
- Adding a recipient through the dynamic form for **EUR, USD, INR and MXN** at both widths.
- Accessibility guidelines (tap targets, labels, contrast), expired quote, limits, provider refusal, history.

These tests do not drive a real browser or device, and do not call the real backend. A device or emulator
end-to-end run (`integration_test`) against the backend is not set up yet.

## Admin console in a real browser (Playwright)

`backend/e2e/` drives `/admin-console/` in headless Chromium against the real API, a real Postgres and the mock
provider, at a **1280px desktop** and a **375px phone** viewport: sign in with a two-step code (a wrong code is
refused), search a user and open the profile, filter transfers and open one (timeline, webhook history, the
"read-only" notice), the reports, the dashboard with limits, and pause then resume new transfers with a fresh code.
It also fails on any console error or Content-Security-Policy violation and on horizontal scrolling.

```bash
cd backend
npx playwright install chromium          # once (CI: --with-deps)
DATABASE_URL=postgres://postgres:almapay@localhost:55432/almapay_test npm run test:e2e   # E2E_PORT=3111 if 3100 is taken
```

`e2e/server.ts` starts the app, wipes and seeds that database (so use a throwaway one) and writes the demo admin's
authenticator secret to a file the test reads. The first run found two real bugs, now fixed: the sign-in form used an
inline style the page's own CSP blocked, and its inputs were not labelled.

## The demo app (sample data, no backend)

`mobile/test/demo` runs the whole demo on a 390px phone (sign-up with any code, home, add a recipient, the keypad, review,
pay, tracking that moves by itself, receipt, a rejected payment coming back, transfers, people search, account, reset), checks
the **"Demo – no real money"** strip on every screen, checks the sample figures against the design reference, and holds the
guards: the real app refuses `ALMAPAY_ENV=demo` in every build mode, never imports the demo, a release demo needs the demo
workflows' flag, and the demo code cannot import `dart:io`, `http`, the web view or secure storage.
`backend/e2e/demo-web-check.mjs` loads the built web demo in headless Chromium at 390px, takes the screenshots in
`docs/demo/screenshots/` and fails on any request outside its own origin. See [`docs/demo/README.md`](docs/demo/README.md).

## Website

```bash
cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

## Dependency audit and secrets

```bash
cd backend && npm audit --omit=dev --audit-level=high && npm run scan-secrets
cd web && npm audit --omit=dev --audit-level=high
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request: backend (install, lint, format, type-check,
build, unit, integration against a Postgres service, coverage thresholds, Playwright browser tests, audit, secret scan), web (lint,
type-check, tests, build, audit) and mobile (format, analyze, tests). It has not yet run on GitHub: the repository
has no commits or remote.

## Known untested code

- Live behaviour of Wise and Airwallex (opt-in tests above); Wise `oauth_partner` mode is mocked only.
- `migrator.ts` (66% lines; the CLI paths for down/status), `job-runner.ts` error and shutdown branches (~82%).
- `wise-http-client.ts` retry and back-off branches (83%); `logout.ts` edge cases (82%).
- Mobile: no device/emulator test, no real-backend test, secure storage and WebView onboarding are faked.
- Load and soak tests, and penetration testing, are not part of this suite.
