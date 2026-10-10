# The AlmaPay demo

A version of the app you can try on a phone **before any real provider exists**. It has sample people, rates and
transfers (Priya in Bengaluru, Juan in Guadalajara, Ama in Accra, from
[`almapay-design-reference.html`](../../almapay-design-reference.html)) and **no backend**: it makes no network call,
holds no money and talks to no bank or payment provider. Every screen carries a **"Demo – no real money"** strip.

What works: welcome, sign up (any details, any code), home, people (search, add someone), send (keypad, fee, rate,
arrival in their time), review the ticket, pay (reference ticket, copy), tracking that moves through each status every
4 seconds, receipt, transfers (waiting, delivered, returned), returned money, and the account screen. On the tracking
screen, **"Make Priya's bank reject this payment"** shows the money coming back. **Account > Reset demo** starts again.

All figures are integers (pence). The sample numbers match the design: £500 to Priya is ₹55,880.62 with a £3.12 fee, £200
to Juan is MX$4,612.00 with a £2.40 fee.

> The demo screens are a **prototype of the design**. The real app's screens are simpler today; they will adopt these
> components later. The demo and the real app share no code beyond the build setup.

## It cannot be a production build

- The real entry point (`lib/main.dart`) refuses `ALMAPAY_ENV=demo` in every build mode and never imports anything
  under `lib/demo` (a test checks both). The demo has its own entry point, `lib/main_demo.dart`.
- The demo code cannot import `dart:io`, `http`, the web view or secure storage, nor the real app's network code (a test
  checks that too), and its server address is `demo.invalid`, which can never resolve.
- A **release** build of the demo also needs `--dart-define=ALMAPAY_DEMO_RELEASE=true`, which only the two demo
  workflows set. Without it the demo refuses to start in a release build.
- On Android the demo is a separate **flavour**: its own app id (`com.almapay.almapay.demo`, so it never replaces
  the real app), its own name, no internet or camera permission, and it is always signed with the debug key, never the
  release key. The real app is built with `--flavor app` (see GO_LIVE.md, mobile release).

## Android: download the APK from GitHub and install it

1. Push the repository to GitHub (the project has no remote yet: create a repository, then `git remote add origin ...`,
   commit and `git push -u origin main`).
2. On GitHub open your repository, click the **Actions** tab, then click the newest run named **Demo APK** (a green tick
   means it finished; it takes about 10 to 15 minutes the first time).
3. Scroll to the bottom of that run's page to the **Artifacts** section and click **almapay-demo-apk**. A zip downloads;
   unzip it to get `almapay-demo.apk`. (Artifacts are kept for 30 days.)
   Easier on a phone: after a push to `main`, open the **Releases** page of the repository (right-hand side of the
   repository's front page), open **Demo build (sample data, no real money)** and tap `almapay-demo.apk` to download it
   directly.
4. On your Android phone: open the downloaded `.apk` (from your browser's downloads or the Files app). Android asks to
   allow installing from this source: tap **Settings**, switch on **Allow from this source**, go back and tap **Install**.
   If Google Play Protect says it cannot scan the app, tap **Install anyway** (it is a debug-signed demo, not from the Play
   Store). If you downloaded the zip on a computer, copy the APK to the phone (USB, email, Drive) or open the zip on the
   phone in Files by Google and extract it.
5. Open **AlmaPay Demo**. To remove it: long-press the icon, Uninstall.

## iPhone (and any phone or computer): the web demo

The same demo runs in the browser, so it works on an iPhone (iOS cannot install an APK).

1. Create a free account at **https://dash.cloudflare.com/sign-up** (Cloudflare Pages is free). Note your **Account ID**
   (Workers & Pages page, right-hand side).
2. Create an API token: **My Profile > API Tokens > Create Token > Create Custom Token**, permission
   **Account > Cloudflare Pages > Edit**, then copy the token.
3. In your GitHub repository: **Settings > Secrets and variables > Actions > New repository secret**. Add
   `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (the id). Optionally add a **variable**
   `CLOUDFLARE_PAGES_PROJECT` (default `almapay-demo`).
4. Push to `main` (or Actions > **Demo web** > **Run workflow**). The first run creates the Pages project and publishes.
5. Your link is **`https://almapay-demo.pages.dev`** (or `https://<your project name>.pages.dev`; if the name is taken
   Cloudflare adds a suffix and the run log prints the exact address). Open it in Safari on the iPhone and tap
   **Share > Add to Home Screen** to get an app icon. The page asks search engines not to index it.

Without the secrets, the **Demo web** workflow still builds the site and keeps it as an artifact (`almapay-demo-web`).

## Run it locally

```bash
cd mobile
flutter run -d chrome -t lib/main_demo.dart --dart-define=ALMAPAY_ENV=demo          # in a browser
flutter run -t lib/main_demo.dart --flavor demo --dart-define=ALMAPAY_ENV=demo       # on a connected Android phone
flutter test test/demo                                                                # the demo's tests
```

Screenshots from the tests are in [`screenshots/`](screenshots/).
