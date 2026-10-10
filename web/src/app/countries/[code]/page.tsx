import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import {
  destinationCodes,
  getDestination,
  availabilityMeta,
  originCountry,
} from "@/lib/countries";
import { getCorridorPricingDisplay } from "@/lib/api";

type RouteParams = { params: Promise<{ code: string }> };

export function generateStaticParams() {
  return destinationCodes().map((code) => ({ code }));
}

export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  const { code } = await params;
  const d = getDestination(code);
  if (!d) return { title: "Country not found" };
  return {
    title: `Send money to ${d.name}`,
    description: `Sending money from the ${originCountry.name} to ${d.name} with SomPay: ${d.currencyName} (${d.currency}) payouts, ${d.transferMethods
      .map((m) => m.label.toLowerCase())
      .join(" and ")}, and current availability.`,
    alternates: { canonical: `/countries/${d.code}` },
  };
}

export default async function CountryPage({ params }: RouteParams) {
  const { code } = await params;
  const d = getDestination(code);
  if (!d) notFound();

  const meta = availabilityMeta[d.availability];
  const pricing = getCorridorPricingDisplay(originCountry.currency, d.currency);

  return (
    <>
      <PageHeader
        eyebrow="Countries"
        title={`Send money to ${d.name}`}
        lead={d.summary}
      />

      <Section>
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="space-y-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-4xl" aria-hidden="true">
                {d.flagEmoji}
              </span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="text-sm text-[var(--color-ink-soft)]">
                {meta.note}
              </span>
            </div>

            <div>
              <h2 className="text-xl">Corridor details</h2>
              <dl className="mt-4 divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white">
                {d.displayInfo.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-1 gap-1 p-4 sm:grid-cols-3 sm:gap-4"
                  >
                    <dt className="text-sm font-medium text-[var(--color-ink-soft)]">
                      {row.label}
                    </dt>
                    <dd className="text-brand-900 text-sm sm:col-span-2">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h2 className="text-xl">Payout methods</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {d.transferMethods.map((m) => (
                  <Card key={m.id}>
                    <CardTitle>{m.label}</CardTitle>
                    <CardBody>{m.description}</CardBody>
                  </Card>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xl">Fees and exchange rate</h2>
              <div className="mt-4 space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5 text-sm">
                <p>
                  <span className="text-brand-900 font-semibold">Fee: </span>
                  {pricing.feeDisplay}
                </p>
                <p>
                  <span className="text-brand-900 font-semibold">
                    Exchange rate:{" "}
                  </span>
                  {pricing.rateDisplay}
                </p>
                <p className="text-[var(--color-ink-soft)]">
                  SomPay does not publish a fixed rate or fee for this corridor.
                  You&apos;ll see the exact figures for your transfer in the app
                  before you confirm. See the{" "}
                  <Link href="/fees" className="underline">
                    Fees
                  </Link>{" "}
                  page.
                </p>
              </div>
            </div>
          </div>

          <aside className="lg:pt-2">
            <div className="sticky top-24 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-card)]">
              <h2 className="text-brand-900 text-base font-semibold">
                {d.name} at a glance
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-ink-soft)]">
                <li>Currency: {d.currency}</li>
                <li>Region: {d.region}</li>
                <li>Send from: {originCountry.name}</li>
                <li>Status: {meta.label}</li>
              </ul>
              <ButtonLink
                href="/how-it-works"
                className="mt-5 w-full"
                size="lg"
              >
                Get Started
              </ButtonLink>
              <Link
                href="/countries"
                className="text-brand-700 hover:text-brand-800 mt-3 block text-center text-sm"
              >
                ← All countries
              </Link>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
