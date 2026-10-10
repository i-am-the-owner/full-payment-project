import { safeJsonLd } from "@/lib/json-ld";
import type { Metadata } from "next";
import Script from "next/script";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { FaqAccordion } from "@/components/FaqAccordion";
import { faqs } from "@/lib/faq";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers to common questions about AaminPay: what it is, how sending money works, supported countries, fees, exchange rates, identity checks, tracking and failed transfers.",
  alternates: { canonical: "/faq" },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  })),
};

export default function FaqPage() {
  return (
    <>
      <PageHeader
        eyebrow="FAQ"
        title="Frequently asked questions"
        lead="If your question isn't answered here, contact us and we'll help."
      />

      <Section containerSize="narrow">
        <FaqAccordion items={faqs} />
        <p className="mt-8 text-sm text-[var(--color-ink-soft)]">
          Still need help? Email{" "}
          <a href={`mailto:${site.contact.supportEmail}`} className="underline">
            {site.contact.supportEmail}
          </a>{" "}
          or use the{" "}
          <a href="/contact" className="underline">
            contact form
          </a>
          .
        </p>
      </Section>

      <Script
        id="faq-jsonld"
        type="application/ld+json"
        // Static content, but `<` is escaped anyway so a `</script>` in an answer
        // could never end the tag.
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
    </>
  );
}
