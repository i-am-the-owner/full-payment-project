import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { ContactForm } from "@/components/ContactForm";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with SomPay — general enquiries, help with a transfer, or business and partnership questions.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Get in touch"
        lead="Send us a message and we'll get back to you. These channels are being set up as we prepare for launch."
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
          <div>
            <h2 className="text-xl">Send a message</h2>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              All fields are required.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-card)]">
              <h2 className="text-brand-900 text-base font-semibold">
                General enquiries
              </h2>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                <a
                  href={`mailto:${site.contact.email}`}
                  className="text-brand-700 underline"
                >
                  {site.contact.email}
                </a>
              </p>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-card)]">
              <h2 className="text-brand-900 text-base font-semibold">
                Support
              </h2>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                Help with an account or a transfer:
                <br />
                <a
                  href={`mailto:${site.contact.supportEmail}`}
                  className="text-brand-700 underline"
                >
                  {site.contact.supportEmail}
                </a>
              </p>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-card)]">
              <h2 className="text-brand-900 text-base font-semibold">
                Business &amp; partnerships
              </h2>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                Working with SomPay or media enquiries:
                <br />
                <a
                  href={`mailto:${site.contact.businessEmail}`}
                  className="text-brand-700 underline"
                >
                  {site.contact.businessEmail}
                </a>
              </p>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6">
              <h2 className="text-brand-900 text-base font-semibold">
                Address
              </h2>
              <address className="mt-2 text-sm text-[var(--color-ink-soft)] not-italic">
                {site.contact.addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                Full company and registered-office details will be published
                before launch.
              </p>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
