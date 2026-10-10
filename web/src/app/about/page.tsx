import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About SomPay",
  description:
    "SomPay's purpose: to make international money transfers simple, transparent and accessible through a modern digital platform. UK-based, starting with the UK to Kenya.",
  alternates: { canonical: "/about" },
};

const values = [
  {
    title: "Simple",
    body: "A clear, guided process with no jargon. You should always know what happens next.",
  },
  {
    title: "Transparent",
    body: "The exchange rate, the fee and the recipient amount are shown before you confirm — and don't change afterwards.",
  },
  {
    title: "Accessible",
    body: "A modern app that works well on the devices people actually use, built to support more countries over time.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="About SomPay"
        lead="SomPay exists to make international money transfers simple, transparent and accessible through a modern digital platform."
      />

      <Section containerSize="narrow">
        <div className="prose text-[var(--color-ink-soft)]">
          <p>
            Sending money across borders is still harder than it should be.
            People often can&apos;t see the real cost until it&apos;s too late,
            and it isn&apos;t always clear where a transfer has got to. SomPay
            is being built to fix that: a straightforward app where you see the
            full cost upfront and can follow your transfer to completion.
          </p>
          <p>
            SomPay is a {site.launchCorridor.from.name}-based business. Our
            first corridor is the {site.launchCorridor.from.name} to{" "}
            {site.launchCorridor.to.name}, and the platform is designed so more
            countries and currencies can be added.
          </p>
          <p>{site.regulatoryNote}</p>
        </div>
      </Section>

      <Section tone="muted" title="What we care about" containerSize="narrow">
        <div className="grid gap-4 sm:grid-cols-3">
          {values.map((v) => (
            <Card key={v.title}>
              <CardTitle>{v.title}</CardTitle>
              <CardBody>{v.body}</CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Where we are" containerSize="narrow">
        <p className="text-[var(--color-ink-soft)]">
          SomPay is in active development. The mobile app and backend are being
          built, and we are completing the registrations and partner onboarding
          needed before opening for live transfers. We&apos;re not publishing
          customer numbers, funding details or a company history here, because
          we only want to state things we can stand behind.
        </p>
      </Section>
    </>
  );
}
