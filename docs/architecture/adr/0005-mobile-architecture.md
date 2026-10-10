# 5. Mobile architecture: feature-first clean architecture

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

The Flutter app targets Android and iOS and must be maintainable as corridors and
features grow. It must never hold secrets and must treat the backend as the
source of truth for all financial values.

## Decision

### Structure

Feature-first. Each feature under `lib/features/<name>/` is a vertical slice:

- `domain/` – entities, repository _interfaces_, use cases. Pure Dart, no Flutter.
- `data/` – repository _implementations_, remote/local data sources, DTOs.
- `presentation/` – widgets, pages, feature state.

Shared/app-level code: `lib/app/` (application shell + build-time environment
configuration) and `lib/shared/` (theming, and later, common widgets/utilities).

Only layers that have real content today exist in the tree. `features/startup/`
is a placeholder screen; `domain/` and `data/` land with the first real feature.

### Environment configuration

The target environment is fixed at build time via
`--dart-define=ALMAPAY_ENV=development|staging|production`, defaulting to
`development`. `lib/app/environment/` resolves it into an immutable `AppConfig`
holding only **non-sensitive** values (backend base URL, display name). No runtime
environment switching.

### State management

None adopted yet. When the first stateful feature arrives, choose the smallest
tool that fits (Flutter's built-in `ChangeNotifier`/`ValueListenable` first).
Adding a state-management package is a separate decision.

### Networking

No HTTP client dependency yet — the app makes no backend calls in Milestone 1.
A `core/network/` layer wrapping `package:http` is added with the first feature
that talks to the backend.

### Linting

`flutter_lints` (official) plus stricter analyzer settings: `strict-casts`,
`strict-inference`, `strict-raw-types`, and errors (not warnings) for
`unawaited_futures` and `dead_code`.

## Consequences

- Consistent, predictable place for every piece of feature code.
- Some empty-looking structure is avoided now at the cost of adding folders as
  features arrive.
- The thin-client rule is architectural: the app has no path to privileged
  systems, only to the AaminPay backend.
