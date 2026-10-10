import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/Container";
import { Section } from "@/components/Section";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import { Steps } from "@/components/Steps";
import { FaqAccordion } from "@/components/FaqAccordion";
import { destinations, availabilityMeta } from "@/lib/countries";
import { faqs } from "@/lib/faq";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.name} — Send money internationally, simply and transparently`,
  description: site.description,
  alternates: { canonical: "/" },
};

const benefits = [
  {
    title: "See the cost upfront",
    body: "The exchange rate, the fee and the amount your recipient receives are all shown before you confirm. No surprises afterwards.",
  },
  {
    title: "Backend-verified status",
    body: "Your transfer's status is confirmed by SomPay's servers, not guessed by your phone. You always see a reliable state.",
  },
  {
    title: "Built for more corridors",
    body: "We are starting with the UK to Kenya and designing the platform so new countries and currencies can be added.",
  },
  {
    title: "Security by design",
    body: "Encrypted connections, secure sign-in, server-side processing of every sensitive step, and monitoring for unusual activity.",
  },
];

const homeSteps = [
  {
    title: "Create your account",
    body: "Sign up with your email and set a strong password.",
  },
  {
    title: "Verify your identity when required",
    body: "We ask for identity checks where the law and our checks require them.",
  },
  {
    title: "Choose a destination and amount",
    body: "Pick where the money is going and how much you want to send.",
  },
  {
    title: "Review the rate and fees, then confirm",
    body: "Check the exchange rate, fee and recipient amount, add the recipient's details, and confirm.",
  },
  {
    title: "Track it to completion",
    body: "Follow your transfer's status until the money reaches the recipient.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-ink-900 overflow-hidden text-white">
        <Container className="py-16 sm:py-24">
          <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-marigold mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold">
                <span
                  aria-hidden="true"
                  className="bg-marigold h-1.5 w-1.5 rounded-full"
                />
                UK&nbsp;→&nbsp;Kenya first · more destinations planned
              </p>
              <h1 className="text-5xl !text-white sm:text-6xl lg:text-7xl">
                Send money abroad.{" "}
                <span className="text-marigold">Simple. Transparent.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-slate-300">
                SomPay is a UK-based digital platform for sending money abroad.
                See the exchange rate and fees before you confirm, then track
                your transfer until it arrives.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/how-it-works" size="lg" variant="accent">
                  Get Started
                </ButtonLink>
                <ButtonLink
                  href="/countries"
                  size="lg"
                  variant="secondary"
                  className="!bg-white/10 !text-white !ring-white/20 hover:!bg-white/15"
                >
                  See destinations
                </ButtonLink>
              </div>
              <p className="mt-7 max-w-xl text-sm text-slate-400">
                SomPay is not yet open for live transfers. We are building the
                product and completing the required registrations and partner
                onboarding.
              </p>
            </div>

            {/* Non-interactive "ticket" — descriptive copy, no fabricated rates */}
            <div className="mx-auto w-full max-w-md lg:rotate-2">
              <div className="ticket shadow-2xl shadow-black/40">
                <div className="ticket-top text-ink-900">
                  <p className="text-sm font-semibold">
                    What you&apos;ll see before confirming
                  </p>
                  <div className="flex items-end justify-between gap-3 font-[family-name:var(--font-display)] text-6xl leading-none font-extrabold">
                    <span>GBP</span>
                    <span
                      aria-hidden="true"
                      className="mb-3 h-0.5 flex-1 border-t-2 border-dashed border-current opacity-60"
                    />
                    <span>KES</span>
                  </div>
                </div>
                <div className="ticket-perf" aria-hidden="true" />
                <dl className="space-y-3 px-6 pt-5 pb-6 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--color-ink-soft)]">You send</dt>
                    <dd className="font-semibold">Amount in GBP</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--color-ink-soft)]">SomPay fee</dt>
                    <dd className="font-semibold">Shown in full</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--color-ink-soft)]">
                      Exchange rate
                    </dt>
                    <dd className="font-semibold">Live at quote time</dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                    <dt className="text-[var(--color-ink-soft)]">
                      Recipient receives
                    </dt>
                    <dd className="text-accent-600 font-semibold">
                      Amount in KES
                    </dd>
                  </div>
                </dl>
              </div>
              <p className="mt-5 text-center text-xs text-slate-400">
                Figures are calculated by SomPay when you request a transfer and
                are shown in the app before you confirm.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* What SomPay does */}
      <Section
        id="what"
        eyebrow="What is SomPay?"
        title="A modern way to send money across borders"
        intro={
          <>
            An international money transfer moves funds from someone in one
            country to someone in another, converting between currencies along
            the way. SomPay handles the quote, the currency conversion, the
            payout to your recipient, and keeps you updated — all from one app.
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((b) => (
            <Card key={b.title} as="article">
              <CardTitle>{b.title}</CardTitle>
              <CardBody>{b.body}</CardBody>
            </Card>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section
        id="how"
        tone="muted"
        eyebrow="How it works"
        title="Five simple steps"
        intro="Not every transfer is instant — delivery time depends on the destination and payout method, and you'll always see an estimate before you confirm."
        containerSize="narrow"
      >
        <Steps steps={homeSteps} />
        <div className="mt-10">
          <ButtonLink href="/how-it-works" variant="secondary">
            Read the full walkthrough
          </ButtonLink>
        </div>
      </Section>

      {/* Supported destinations */}
      <Section
        id="destinations"
        eyebrow="Supported destinations"
        title="Where you can send money"
        intro="Our first corridor is the United Kingdom to Kenya. The platform is built to add more."
      >
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((d) => {
            const meta = availabilityMeta[d.availability];
            return (
              <Card key={d.code} as="li">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden="true">
                      {d.flagEmoji}
                    </span>
                    <div>
                      <CardTitle>{d.name}</CardTitle>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {d.currency} · {d.region}
                      </p>
                    </div>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <CardBody>{d.summary}</CardBody>
                <Link
                  href={`/countries/${d.code}`}
                  className="text-brand-700 hover:text-brand-800 mt-4 inline-block text-sm font-semibold"
                >
                  Details about {d.name} →
                </Link>
              </Card>
            );
          })}
        </ul>
        <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
          A destination is only opened for live transfers once the backend and
          our payout partner confirm it.
        </p>
      </Section>

      {/* Security */}
      <Section
        id="security"
        tone="ink"
        eyebrow="Security"
        title="Your money and your data, protected"
        intro="SomPay is built as a fintech product from the ground up."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Encrypted connections", "All traffic uses HTTPS/TLS."],
            [
              "Secure authentication",
              "Passwords are hashed with a strong algorithm; sessions can be revoked instantly.",
            ],
            [
              "Server-side processing",
              "Fees, exchange rates and transfer status are decided on our servers, never on your device.",
            ],
            [
              "Data minimisation",
              "We collect only what a transfer and the required checks need.",
            ],
            [
              "Monitoring",
              "Sensitive actions are logged to an append-only audit trail and watched for unusual patterns.",
            ],
            [
              "No secrets in the app",
              "The mobile app never holds payment-provider credentials or signing keys.",
            ],
          ].map(([t, b]) => (
            <div
              key={t}
              className="rounded-[var(--radius-lg)] border border-white/10 bg-white/5 p-5"
            >
              <h3 className="text-base font-semibold !text-white">{t}</h3>
              <p className="mt-1.5 text-sm text-slate-300">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-10">
          <ButtonLink
            href="/security"
            variant="secondary"
            className="!text-brand-900 !bg-white"
          >
            Read about security
          </ButtonLink>
        </div>
      </Section>

      {/* FAQ */}
      <Section
        id="faq"
        eyebrow="FAQ"
        title="Common questions"
        containerSize="narrow"
      >
        <FaqAccordion items={faqs.slice(0, 5)} />
        <div className="mt-8">
          <ButtonLink href="/faq" variant="ghost">
            See all questions →
          </ButtonLink>
        </div>
      </Section>

      {/* CTA */}
      <Section id="cta" tone="muted" containerSize="narrow">
        <div className="bg-marigold text-ink-900 rounded-[var(--radius-xl)] px-8 py-14 text-center">
          <h2 className="text-ink-900 text-3xl sm:text-4xl">
            Ready when SomPay launches?
          </h2>
          <p className="text-ink-900/80 mx-auto mt-3 max-w-lg">
            Learn how the transfer process works and what you&apos;ll need to
            get started.
          </p>
          <div className="mt-7 flex justify-center">
            <ButtonLink href="/how-it-works" size="lg" variant="primary">
              Get Started
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
