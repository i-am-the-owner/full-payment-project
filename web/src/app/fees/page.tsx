import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Card, CardBody, CardTitle } from "@/components/Card";

export const metadata: Metadata = {
  title: "Fees",
  description:
    "How AaminPay's fees and exchange rates work. You see the transfer fee, the exchange rate and the amount your recipient receives before you confirm. Commercial pricing is not yet finalised.",
  alternates: { canonical: "/fees" },
};

export default function FeesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Fees"
        title="Clear pricing, shown before you confirm"
        lead="Every transfer has two parts to its cost: a transfer fee and the exchange rate. AaminPay shows you both — and the exact amount your recipient will receive — before you commit."
      />

      <Section containerSize="narrow">
        <div className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">
            Commercial pricing is not finalised.
          </strong>{" "}
          The amounts below are described in general terms only. AaminPay does not
          publish a specific fee or a specific exchange rate on this page. The
          real figures for your transfer are calculated at the time you request
          it and are shown in the app.
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle>Transfer fee</CardTitle>
            <CardBody>
              A fee set by AaminPay for processing your transfer. It is shown as a
              clear amount in your sending currency before you confirm. When
              pricing is finalised, the current fee will be published here.
            </CardBody>
          </Card>
          <Card>
            <CardTitle>Exchange rate</CardTitle>
            <CardBody>
              The rate used to convert your money into the recipient&apos;s
              currency. AaminPay calculates it from current wholesale rates when
              you request a transfer. The rate you see is the rate applied to
              your transfer, held for a limited time.
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section
        tone="muted"
        title="What you'll see at quote time"
        containerSize="narrow"
      >
        <dl className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white">
          {[
            ["You send", "The amount you enter, in your sending currency."],
            ["Transfer fee", "AaminPay's fee for this transfer."],
            ["Total to pay", "The amount you send plus the transfer fee."],
            ["Exchange rate", "The rate applied to convert your money."],
            [
              "Recipient receives",
              "The exact amount your recipient will get, in their currency.",
            ],
          ].map(([term, def]) => (
            <div
              key={term}
              className="grid grid-cols-1 gap-1 p-4 sm:grid-cols-3 sm:gap-4"
            >
              <dt className="text-brand-900 text-sm font-semibold">{term}</dt>
              <dd className="text-sm text-[var(--color-ink-soft)] sm:col-span-2">
                {def}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
          There are no charges added after you confirm. If a quote expires
          before you confirm, request a fresh one — the rate may have changed.
        </p>
      </Section>

      <Section containerSize="narrow">
        <h2 className="text-xl">Questions about pricing?</h2>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          The{" "}
          <Link href="/faq" className="underline">
            FAQ
          </Link>{" "}
          explains how fees are calculated and how the exchange rate is
          determined. You can also{" "}
          <Link href="/contact" className="underline">
            contact us
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
