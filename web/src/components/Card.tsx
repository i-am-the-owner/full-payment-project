import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li";
}) {
  return (
    <Tag
      className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-brand-900 text-lg font-semibold">{children}</h3>;
}

export function CardBody({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
      {children}
    </p>
  );
}
