import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { destinations, availabilityMeta, originCountry } from "@/lib/countries";

export const metadata: Metadata = {
  title: "Countries",
  description:
    "Destinations SomPay supports or is building. Our first corridor is the United Kingdom to Kenya. Each destination lists its currency, payout methods and current availability.",
  alternates: { canonical: "/countries" },
};

export default function CountriesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Countries"
        title="Where SomPay sends money"
        lead={
          <>
            All transfers currently start in the {originCountry.name} (
            {originCountry.currency}). The list below is data-driven — as we
            open new corridors they appear here automatically.
          </>
        }
      />

      <Section>
        <ul className="grid gap-5 md:grid-cols-2">
          {destinations.map((d) => {
            const meta = availabilityMeta[d.availability];
            return (
              <Card key={d.code} as="li">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl" aria-hidden="true">
                      {d.flagEmoji}
                    </span>
                    <div>
                      <CardTitle>{d.name}</CardTitle>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {d.currencyName} ({d.currency}) · {d.region}
                      </p>
                    </div>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>

                <CardBody>{d.summary}</CardBody>

                <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
                  {meta.note}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-[var(--color-ink-soft)]">
                    Payout methods
                  </dt>
                  <dd className="text-brand-900 font-medium">
                    {d.transferMethods.map((m) => m.label).join(", ")}
                  </dd>
                  <dt className="text-[var(--color-ink-soft)]">Send from</dt>
                  <dd className="text-brand-900 font-medium">
                    {originCountry.name} ({originCountry.currency})
                  </dd>
                </dl>

                <Link
                  href={`/countries/${d.code}`}
                  className="text-brand-700 hover:text-brand-800 mt-5 inline-block text-sm font-semibold"
                >
                  View {d.name} details →
                </Link>
              </Card>
            );
          })}
        </ul>
      </Section>

      <Section
        tone="muted"
        containerSize="narrow"
        title="Adding more countries"
      >
        <p className="text-[var(--color-ink-soft)]">
          SomPay is deliberately built as a multi-corridor platform. Each
          destination is described by a small set of structured fields — country
          name and code, currency, availability status, payout methods and
          display information — so new corridors can be added without
          redesigning the product. A corridor is only marked{" "}
          <span className="text-brand-800 font-semibold">Available</span> once
          the backend and the payout provider confirm it is open for real
          transfers.
        </p>
      </Section>
    </>
  );
}
