/**
 * Data-driven destination catalogue.
 *
 * The website architecture is deliberately NOT Kenya-specific. To add a
 * destination, append an entry to `destinations` below — every page that lists
 * or renders countries reads from this array.
 *
 * `availability` must never be set to `"live"` for a corridor until the backend
 * and the payout provider have confirmed it is open for real transfers.
 */

export type Availability = "live" | "in_development" | "planned";

export interface TransferMethod {
  id: string;
  label: string;
  description: string;
}

export interface Destination {
  /** ISO 3166-1 alpha-2 country code, lowercase, used in the URL. */
  code: string;
  name: string;
  /** ISO 4217 currency code paid out to the recipient. */
  currency: string;
  currencyName: string;
  region: string;
  flagEmoji: string;
  availability: Availability;
  /** Short sentence shown on cards and the country page. */
  summary: string;
  /** Payout methods we intend to support for this corridor. */
  transferMethods: TransferMethod[];
  /** Extra facts rendered as a definition list on the country page. */
  displayInfo: { label: string; value: string }[];
}

export const availabilityMeta: Record<
  Availability,
  { label: string; tone: "positive" | "neutral" | "muted"; note: string }
> = {
  live: {
    label: "Available",
    tone: "positive",
    note: "Open for transfers.",
  },
  in_development: {
    label: "In development",
    tone: "neutral",
    note: "We are building and testing this corridor. It is not yet open for live transfers.",
  },
  planned: {
    label: "Planned",
    tone: "muted",
    note: "On our roadmap. No date confirmed yet.",
  },
};

const bankTransfer: TransferMethod = {
  id: "bank",
  label: "Bank account",
  description:
    "Funds are paid into the recipient's bank account using local payment rails.",
};

const mobileMoney: TransferMethod = {
  id: "mobile_money",
  label: "Mobile money",
  description:
    "Funds are sent to the recipient's mobile-money wallet. Availability depends on the destination and provider support.",
};

export const destinations: Destination[] = [
  {
    code: "ke",
    name: "Kenya",
    currency: "KES",
    currencyName: "Kenyan shilling",
    region: "East Africa",
    flagEmoji: "🇰🇪",
    availability: "in_development",
    summary:
      "Our first corridor. Send Kenyan shillings from the UK to a bank account or mobile-money wallet.",
    transferMethods: [bankTransfer, mobileMoney],
    displayInfo: [
      { label: "Send from", value: "United Kingdom (GBP)" },
      { label: "Recipient receives", value: "Kenyan shilling (KES)" },
      { label: "Payout options", value: "Bank account, mobile money" },
      {
        label: "Delivery time",
        value: "Varies by payout method and bank. Shown before you confirm.",
      },
    ],
  },
];

/** All corridors originate in the UK for the initial launch. */
export const originCountry = {
  name: "United Kingdom",
  code: "gb",
  currency: "GBP",
};

export function getDestination(code: string): Destination | undefined {
  return destinations.find((d) => d.code === code.toLowerCase());
}

export function destinationCodes(): string[] {
  return destinations.map((d) => d.code);
}
