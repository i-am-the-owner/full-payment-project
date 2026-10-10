import type { ReactNode } from "react";
import { Container } from "./Container";

/** A vertical page section with consistent rhythm and optional heading. */
export function Section({
  children,
  id,
  title,
  eyebrow,
  intro,
  tone = "surface",
  className = "",
  containerSize = "default",
}: {
  children: ReactNode;
  id?: string;
  title?: string;
  eyebrow?: string;
  intro?: ReactNode;
  tone?: "surface" | "muted" | "ink";
  className?: string;
  containerSize?: "default" | "narrow" | "wide";
}) {
  const toneClass =
    tone === "muted"
      ? "bg-[var(--color-surface-muted)]"
      : tone === "ink"
        ? "bg-ink-900 text-slate-200"
        : "bg-white";

  return (
    <section
      id={id}
      className={`py-16 sm:py-20 ${toneClass} ${className}`}
      aria-labelledby={title && id ? `${id}-heading` : undefined}
    >
      <Container size={containerSize}>
        {(eyebrow || title || intro) && (
          <div className="mb-10 max-w-2xl">
            {eyebrow && (
              <p
                className={`mb-2 text-sm font-semibold tracking-wide uppercase ${
                  tone === "ink" ? "text-marigold" : "text-marigold-deep"
                }`}
              >
                {eyebrow}
              </p>
            )}
            {title && (
              <h2
                id={id ? `${id}-heading` : undefined}
                className={`text-3xl sm:text-4xl ${tone === "ink" ? "!text-white" : ""}`}
              >
                {title}
              </h2>
            )}
            {intro && (
              <div
                className={`mt-3 text-base leading-relaxed ${
                  tone === "ink"
                    ? "text-slate-300"
                    : "text-[var(--color-ink-soft)]"
                }`}
              >
                {intro}
              </div>
            )}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}
