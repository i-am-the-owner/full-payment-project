# AaminPay website

The public marketing website for **AaminPay**, a UK-based international
money-transfer platform. First launch corridor: **UK → Kenya**, with a
data-driven structure so more corridors can be added.

This is a **separate project** from the AaminPay mobile app (`../mobile/`) and
backend (`../backend/`). It contains **no secrets, no API keys, and no Wise
credentials or endpoints** — it is a public site.

## Tech

|               |                                                                          |
| ------------- | ------------------------------------------------------------------------ |
| Framework     | Next.js 16 (App Router, Turbopack)                                       |
| Language      | TypeScript (strict)                                                      |
| Styling       | Tailwind CSS v4 + a small design-token system in `src/app/globals.css`   |
| Tests         | Vitest (unit tests for pure logic + the contact route)                   |
| Lint / format | ESLint (`eslint-config-next`) + Prettier (`prettier-plugin-tailwindcss`) |

## Run it locally

```bash
cd web
npm install
npm run dev            # http://localhost:3000

npm run build          # production build
npm start              # serve the production build

npm test               # vitest
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npx prettier --check "src/**/*.{ts,tsx,css}"
```

> The mobile app dev backend also defaults to port 3000. Run the website on a
> different port if both are up: `npm run dev -- -p 3001`.

## Structure

```
src/
├── app/
│   ├── layout.tsx            Root layout: header, footer, global metadata
│   ├── page.tsx              Home
│   ├── how-it-works/         How It Works
│   ├── countries/            Countries index + [code] dynamic country page
│   ├── fees/  security/  about/  faq/  contact/
│   ├── privacy/ terms/ cookies/   Legal drafts (marked DRAFT, noindex)
│   ├── api/contact/route.ts  Contact-form handler (validates; no delivery yet)
│   ├── sitemap.ts  robots.ts
│   └── not-found.tsx
├── components/               Header, Footer, Section, Card, Button, Steps,
│                             FaqAccordion, ContactForm, PageHeader, Badge, …
└── lib/
    ├── site.ts               Public site config + regulatory wording
    ├── nav.ts                Navigation model
    ├── countries.ts          Data-driven destination catalogue
    ├── faq.ts                FAQ content
    ├── validation.ts         Shared contact-form validation (client + server)
    └── api.ts                Backend service abstraction (not yet connected)
```

## Content and claims

The copy is deliberately conservative. The site does **not** claim AaminPay is
FCA authorised / regulated, licensed, a bank, "fully regulated", the cheapest or
the fastest, or available everywhere. It does not publish a fixed fee or a fixed
exchange rate, and it does not describe any corridor as open for live transfers.
Adjust `src/lib/site.ts` (`regulatoryNote`) and `src/lib/countries.ts`
(`availability`) only when you have verified information.

## Connecting the backend later

`src/lib/api.ts` is the single seam. When the AaminPay backend is ready:

1. Add a **server-only** env var (never `NEXT_PUBLIC_*`) for the backend URL /
   any credential.
2. Implement the real calls inside the route handlers under `src/app/api/`
   (server-side) and/or in `src/lib/api.ts`.
3. Keep the exported function signatures stable so pages don't change.

`src/app/api/contact/route.ts` has a `DELIVERY_CONFIGURED` flag and a comment
block describing exactly where to wire a real destination (transactional email,
helpdesk webhook, or the backend).

## Deployment notes

- Set `NEXT_PUBLIC_SITE_URL` to the real domain (used for canonical URLs, the
  sitemap and robots). The placeholder is `https://www.aaminpay.example`.
- The site is fully static except `/api/contact`.
