import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { DraftNotice } from "@/components/DraftNotice";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Cookie Policy (Draft)",
  description:
    "Draft cookie policy describing how AaminPay's website uses cookies and similar technologies. Requires legal review before production.",
  alternates: { canonical: "/cookies" },
  robots: { index: false, follow: true },
};

export default function CookiesPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Cookie Policy" />

      <Section containerSize="narrow">
        <DraftNotice />
        {/* TODO-LEGAL: replace with the final cookie notice: the cookies and similar technologies actually used (the site sets none today), consent mechanism if any are added, and the retention of each. */}

        <div className="prose mt-10 text-[var(--color-ink)]">
          <p className="text-[var(--color-ink-soft)]">
            This draft describes how AaminPay&apos;s website intends to use
            cookies and similar technologies. It will be finalised with legal
            advice, and a cookie-consent mechanism will be added, before AaminPay
            launches.
          </p>

          <h2>1. What cookies are</h2>
          <p>
            Cookies are small files stored on your device by a website. Similar
            technologies include local storage and pixels. They can be used to
            make a site work, to remember preferences, and to measure how a site
            is used.
          </p>

          <h2>2. How this website currently uses them</h2>
          <p>
            The current marketing website is built to work without non-essential
            cookies. It does not set advertising or third-party tracking
            cookies. If that changes, this policy and a consent banner will be
            updated first.
          </p>

          <h2>3. Categories we may use</h2>
          <ul>
            <li>
              <strong>Strictly necessary</strong> — needed for the site or app
              to function and to keep it secure. These do not require consent.
            </li>
            <li>
              <strong>Preferences</strong> — remember choices such as language.
            </li>
            <li>
              <strong>Analytics</strong> — help us understand aggregate usage so
              we can improve the site. These will only be set with your consent.
            </li>
          </ul>

          <h2>4. Managing cookies</h2>
          <p>
            You can control and delete cookies through your browser settings.
            Blocking some cookies may affect how the site works. When a consent
            tool is added, you will be able to change your choices at any time.
          </p>

          <h2>5. Contact</h2>
          <p>
            Questions about cookies can be sent to{" "}
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
