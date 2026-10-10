import Link from "next/link";
import { Container } from "./Container";
import { Logo } from "./Logo";
import { primaryNav, legalNav } from "@/lib/nav";
import { site } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-[var(--color-ink-soft)]">
              {site.tagline}
            </p>
          </div>

          <nav aria-label="Footer" className="text-sm">
            <h2 className="text-brand-900 font-[family-name:var(--font-sans)] font-semibold tracking-normal normal-case">
              Explore
            </h2>
            <ul className="mt-3 space-y-2">
              {primaryNav.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="hover:text-brand-700 text-[var(--color-ink-soft)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="text-sm">
            <h2 className="text-brand-900 font-[family-name:var(--font-sans)] font-semibold tracking-normal normal-case">
              Legal
            </h2>
            <ul className="mt-3 space-y-2">
              {legalNav.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="hover:text-brand-700 text-[var(--color-ink-soft)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-sm">
            <h2 className="text-brand-900 font-[family-name:var(--font-sans)] font-semibold tracking-normal normal-case">
              Contact
            </h2>
            <ul className="mt-3 space-y-2 text-[var(--color-ink-soft)]">
              <li>
                <a
                  href={`mailto:${site.contact.email}`}
                  className="hover:text-brand-700"
                >
                  {site.contact.email}
                </a>
              </li>
              <li>
                <Link href="/contact" className="hover:text-brand-700">
                  Contact form
                </Link>
              </li>
              {site.contact.addressLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-[var(--color-border)] pt-6">
          <p
            data-testid="payment-statement"
            className="text-xs leading-relaxed font-medium text-[var(--color-ink)]"
          >
            {site.paymentStatement}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            {site.regulatoryNote}
          </p>
          <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
            © {year} {site.name}. All rights reserved.{" "}
            {site.company.legalNameNote}
          </p>
        </div>
      </Container>
    </footer>
  );
}
