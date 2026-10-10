import type { ReactNode } from "react";
import { Container } from "./Container";

/** Standard title block at the top of an interior page. */
export function PageHeader({
  title,
  lead,
  eyebrow,
}: {
  title: string;
  lead?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      <Container className="py-14 sm:py-16">
        <div className="max-w-2xl">
          {eyebrow && (
            <p className="text-brand-600 mb-2 text-sm font-semibold tracking-wide uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="text-3xl sm:text-4xl">{title}</h1>
          {lead && (
            <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-soft)]">
              {lead}
            </p>
          )}
        </div>
      </Container>
    </div>
  );
}
