import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { DraftNotice } from "@/components/DraftNotice";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms & Conditions (Draft)",
  description:
    "Draft terms and conditions for using SomPay. Requires legal review before production.",
  alternates: { canonical: "/terms" },
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms & Conditions" />

      <Section containerSize="narrow">
        <DraftNotice />
        {/* TODO-LEGAL: replace with the final terms: company and registered office, the provider's service terms and how they sit alongside ours, fees and refund wording, complaints and the Financial Ombudsman Service route, governing law, liability limits, the 'we do not hold customer funds' statement in its approved form. */}

        <div className="prose mt-10 text-[var(--color-ink)]">
          <p className="text-[var(--color-ink-soft)]">
            This draft outlines the intended terms for using SomPay. It is not
            in force, and it will be replaced by a legally reviewed version
            before SomPay launches.
          </p>

          <h2>1. About these terms</h2>
          <p>
            These terms will govern your use of SomPay&apos;s website and app
            and the money-transfer service. By using the service you will be
            agreeing to the final version of these terms.
          </p>

          <h2>2. Eligibility</h2>
          <p>
            You will need to be of legal age, resident where the service is
            offered, and able to pass the identity and other checks SomPay is
            required to carry out.
          </p>

          <h2>3. Your account</h2>
          <p>
            You are responsible for keeping your login details secure and for
            activity on your account. Tell us immediately if you think your
            account has been compromised.
          </p>

          <h2>4. Transfers</h2>
          <ul>
            <li>
              Before you confirm a transfer, SomPay will show you the exchange
              rate, the fee and the amount the recipient will receive.
            </li>
            <li>
              A quote is valid for a limited time. If it expires, you may need a
              new one.
            </li>
            <li>
              You are responsible for the accuracy of the recipient details you
              provide.
            </li>
            <li>
              Delivery times vary by destination and payout method and are
              estimates, not guarantees.
            </li>
          </ul>

          <h2>5. Cancellations, failures and refunds</h2>
          <p>
            If a transfer cannot be completed it will be marked as failed and
            the reason recorded. Depending on the stage it failed at, funds will
            either not be taken or will be returned. The final terms will set
            out cancellation windows and refund handling.
          </p>

          <h2>6. Acceptable use</h2>
          <p>
            You must not use SomPay for unlawful purposes, including money
            laundering, terrorist financing, fraud or sanctions evasion. SomPay
            may refuse, delay or reverse a transfer to meet its legal
            obligations.
          </p>

          <h2>7. Liability</h2>
          <p>
            The final terms will set out SomPay&apos;s responsibilities and the
            limits of its liability, in line with applicable law. Nothing will
            exclude liability that cannot be excluded by law.
          </p>

          <h2>8. Changes</h2>
          <p>
            SomPay may update these terms. Material changes will be communicated
            before they take effect.
          </p>

          <h2>9. Contact</h2>
          <p>
            Questions about these terms can be sent to{" "}
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>.
          </p>

          <p className="text-sm text-[var(--color-ink-soft)]">
            Last updated: draft. This document has not been reviewed by a legal
            adviser and does not create any binding obligations.
          </p>
        </div>
      </Section>
    </>
  );
}
