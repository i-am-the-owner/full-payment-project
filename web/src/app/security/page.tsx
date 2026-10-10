import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Card, CardBody, CardTitle } from "@/components/Card";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How AaminPay protects your money and your information: encrypted connections, secure authentication, server-side processing, data minimisation, audit logging and monitoring for fraud.",
  alternates: { canonical: "/security" },
};

const practices = [
  {
    title: "Secure connections",
    body: "All communication between the app and AaminPay uses HTTPS/TLS. Traffic is encrypted in transit.",
  },
  {
    title: "Encryption",
    body: "Sensitive data is encrypted in transit, and stored data is protected with encryption at rest. We are adding further field-level protection for the most sensitive records as we prepare for launch.",
  },
  {
    title: "Secure authentication",
    body: "Passwords are stored only as strong one-way hashes, never in plain text. Sign-in uses short-lived access tokens, and your session is checked on every request so access can be revoked immediately.",
  },
  {
    title: "Protection of your information",
    body: "We practise data minimisation — collecting only what a transfer and the required checks need — and we restrict who can access customer data internally.",
  },
  {
    title: "Secure server-side processing",
    body: "Fees, exchange rates and whether a transfer has completed are all decided by AaminPay's servers. The app cannot change a price or mark a transfer as successful — it only displays the verified result.",
  },
  {
    title: "Monitoring and fraud prevention",
    body: "Security- and money-relevant actions are written to an append-only audit trail. We apply rate limiting, account-lockout protection and checks designed to detect unusual activity, and we are building further fraud controls before launch.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Built to protect your money and your data"
        lead="AaminPay is designed as a fintech product, with security considered at every layer — from the mobile app to the database."
      />

      <Section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {practices.map((p) => (
            <Card key={p.title} as="article">
              <CardTitle>{p.title}</CardTitle>
              <CardBody>{p.body}</CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="muted" title="What we don't claim" containerSize="narrow">
        <p className="text-[var(--color-ink-soft)]">
          We will not display security certifications, audit badges or
          regulatory approvals that AaminPay does not hold. As the product matures
          and independent assessments are completed, this page will be updated
          with accurate, verifiable information. If you have a security concern,
          please{" "}
          <a href="/contact" className="underline">
            contact us
          </a>
          .
        </p>
      </Section>

      <Section title="Your part" containerSize="narrow">
        <ul className="prose text-[var(--color-ink-soft)]">
          <li>Use a strong, unique password for your AaminPay account.</li>
          <li>Keep your device’s operating system and the app up to date.</li>
          <li>
            Only download the AaminPay app from an official app store when it is
            available.
          </li>
          <li>
            AaminPay will never ask for your password by email, message or phone.
          </li>
        </ul>
      </Section>
    </>
  );
}
