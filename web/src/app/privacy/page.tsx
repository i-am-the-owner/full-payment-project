import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { DraftNotice } from "@/components/DraftNotice";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy (Draft)",
  description:
    "Draft privacy policy describing how AaminPay intends to collect, use and protect personal data. Requires legal review before production.",
  alternates: { canonical: "/privacy" },
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy Policy" />

      <Section containerSize="narrow">
        <DraftNotice />
        {/* TODO-LEGAL: replace with the final privacy policy: controller identity and ICO registration number, lawful bases, retention periods (see GO_LIVE), international transfers and the provider as an independent controller, data-subject rights contact, DPO if required. */}

        <div className="prose mt-10 text-[var(--color-ink)]">
          <p className="text-[var(--color-ink-soft)]">
            This draft describes how AaminPay intends to handle personal data. It
            will be finalised with legal advice before AaminPay launches.
          </p>

          <h2>1. Who we are</h2>
          <p>
            AaminPay is a {site.launchCorridor.from.name}-based digital
            money-transfer platform. {site.company.legalNameNote} The data
            controller&apos;s registered details will be confirmed here before
            launch.
          </p>

          <h2>2. What we collect</h2>
          <ul>
            <li>
              <strong>Account information</strong> — such as your name, email
              address and password (stored only as a secure hash).
            </li>
            <li>
              <strong>Identity information</strong> — documents and details
              needed to verify your identity where required by law.
            </li>
            <li>
              <strong>Transfer information</strong> — the amounts, currencies,
              destinations and recipient details for transfers you create.
            </li>
            <li>
              <strong>Technical information</strong> — device and connection
              data needed to operate the service securely, and to detect and
              prevent fraud.
            </li>
          </ul>

          <h2>3. Why we use it</h2>
          <ul>
            <li>To provide the money-transfer service you ask for.</li>
            <li>
              To meet legal and regulatory obligations, including identity
              verification and financial-crime checks.
            </li>
            <li>To keep the service and your account secure.</li>
            <li>To respond to your enquiries and provide support.</li>
          </ul>

          <h2>4. Sharing</h2>
          <p>
            We will share personal data only where necessary — for example with
            payment and payout partners to complete a transfer, with identity
            and fraud-check providers, and with authorities where the law
            requires. A full list of categories of recipients and sub-processors
            will be published here.
          </p>

          <h2>5. International transfers</h2>
          <p>
            Because AaminPay moves money internationally, some data may be
            processed outside the {site.launchCorridor.from.name}. Where that
            happens, appropriate safeguards will be put in place.
          </p>

          <h2>6. Retention</h2>
          <p>
            We keep personal data only as long as needed for the purposes above
            and to meet legal record-keeping requirements. A detailed retention
            schedule will be published.
          </p>

          <h2>7. Your rights</h2>
          <p>
            Subject to the law, you may have the right to access, correct or
            delete your personal data, to object to or restrict certain
            processing, and to data portability. Details of how to exercise
            these rights, and how to complain to a supervisory authority, will
            be provided here.
          </p>

          <h2>8. Contact</h2>
          <p>
            Questions about privacy can be sent to{" "}
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>.
          </p>

          <p className="text-sm text-[var(--color-ink-soft)]">
            Last updated: draft. This document has not been reviewed by a legal
            adviser.
          </p>
        </div>
      </Section>
    </>
  );
}
