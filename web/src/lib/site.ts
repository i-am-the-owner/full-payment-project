/**
 * Central site configuration.
 *
 * These are public, non-sensitive values only. No API keys, provider
 * credentials, database strings or secrets belong in this file or anywhere in
 * the web project — it is served to the browser.
 */

export const site = {
  name: "AaminPay",
  /** One-line description used for metadata and the hero sub-headline. */
  tagline: "International money transfers, made simple and transparent.",
  description:
    "AaminPay is a UK-based digital platform for sending money internationally. See the exchange rate and fees before you confirm, then track your transfer to completion.",
  /**
   * Canonical site URL. Override at build time with NEXT_PUBLIC_SITE_URL.
   * The placeholder domain is intentional until the real domain is registered.
   */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.aaminpay.example",
  locale: "en_GB",

  /** Launch corridor. The architecture supports adding more (see lib/countries.ts). */
  launchCorridor: {
    from: { name: "United Kingdom", code: "GB" },
    to: { name: "Kenya", code: "KE" },
  },

  /**
   * Contact details. PLACEHOLDERS — replace with real, monitored channels
   * before launch.
   */
  contact: {
    email: "hello@aaminpay.example",
    supportEmail: "support@aaminpay.example",
    businessEmail: "partnerships@aaminpay.example",
    addressLines: [
      "AaminPay (TODO-LEGAL: registered company name and number)",
      "TODO-LEGAL: registered office address, United Kingdom",
    ],
  },

  /**
   * Regulatory / status wording.
   *
   * IMPORTANT: AaminPay must NOT be described as FCA authorised, FCA regulated,
   * licensed, a bank, or "fully regulated" until that status is confirmed and
   * the exact approved wording is supplied. Keep this string factual and modest.
   */
  regulatoryNote:
    "AaminPay is building its product and completing the required registrations and partner onboarding. It is not yet open for live transfers. Nothing on this site should be read as confirmation of any regulatory authorisation or licence.",

  company: {
    /** Do not invent a founding year, headcount, customer numbers or history. */
    legalNameNote:
      "TODO-LEGAL: legal entity name, company number and registered office.",
  },

  /**
   * Who provides the payment. Shown in the footer and mirrored on the app's pay
   * screen. TODO-LEGAL: replace "[provider name]" with the provider's legal
   * name and add its regulatory status in the lawyer's wording. Both facts must
   * stay: the provider supplies the payment service; AaminPay holds no funds.
   */
  paymentStatement:
    "Payments are provided by [provider name] (TODO-LEGAL: the licensed payout provider's legal name and regulatory status). AaminPay does not hold customer funds.",
} as const;

export type Site = typeof site;
