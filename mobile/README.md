# AlmaPay mobile

Flutter application for AlmaPay (Android and iOS).

## Requirements

- Flutter 3.47.x stable (Dart 3.13.x)
- Android SDK (for Android builds) / Xcode (for iOS builds)

## Setup

```bash
flutter pub get
flutter run                                   # development environment
flutter run --dart-define=ALMAPAY_ENV=staging # or staging / production
```

## Quality gates

```bash
dart format .
flutter analyze
flutter test
```

## Environments

The app is built for exactly one environment, chosen at build time:

| `ALMAPAY_ENV` | Display name        | API base URL                          |
| ------------- | ------------------- | ------------------------------------- |
| `development` (default) | `AlmaPay (Dev)`     | `http://10.0.2.2:3000` (emulator host) |
| `staging`     | `AlmaPay (Staging)` | `https://staging.api.almapay.example` |
| `production`  | `AlmaPay`           | `https://api.almapay.example`         |

The `*.almapay.example` hosts are placeholders until the environments are
provisioned. Resolution and values live in `lib/app/environment/`.

## Architecture

Feature-first clean architecture. Each feature is a vertical slice:

```
lib/
  main.dart                     Entry: resolve environment -> AppConfig -> AuthDependencies -> run.
  app/
    almapay_app.dart            Root MaterialApp; restores the session on startup.
    environment/                Build-time environment + configuration (no secrets).
  core/
    auth/                       AuthTokens, TokenStore (SecureTokenStore), AuthDependencies.
    network/                    AuthApi, ApiException, AuthenticatedClient (token attach + refresh).
  features/
    auth/
      domain/                   AuthUser, AuthRepository.
      data/                     AuthRepositoryImpl.
      presentation/             AuthController, AuthGate, login/register pages.
    home/presentation/          Authenticated landing (placeholder until send-money).
  shared/theme/                 App-wide theming.
```

### Authentication

The session's access + refresh tokens are stored **only** in the platform
keystore via `flutter_secure_storage` (`SecureTokenStore`): iOS Keychain
`first_unlock_this_device` (not iCloud-synced, not restored to a new device);
Android AES-GCM with a Keystore-wrapped key. `AuthenticatedClient` attaches the
access token and, on a `401`, refreshes once (single-flight) and retries; a
failed refresh clears storage and signs the user out. See
[`../docs/architecture/adr/0008-authentication.md`](../docs/architecture/adr/0008-authentication.md).

## Security

- **No secrets in this app.** No Wise credentials, backend secrets, signing keys,
  database credentials, or client secrets. Only the public API base URL. All
  privileged calls go through the AlmaPay backend.
- Signing material (`key.properties`, keystores, `google-services.json`,
  `GoogleService-Info.plist`) is git-ignored and provided out of band.
- Production talks to the backend over HTTPS only.
- Token values are never logged; `AuthTokens.toString()` is redacted.
