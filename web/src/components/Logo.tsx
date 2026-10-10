import Link from "next/link";
import { site } from "@/lib/site";

/**
 * Text-plus-mark wordmark. The mark is a simple inline SVG (a ticket with an
 * arrow, as in the app) — no external
 * asset, no fake brand badge.
 */
export function Logo({
  className = "",
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className={`text-brand-900 inline-flex items-center gap-2 font-bold tracking-tight ${className}`}
      aria-label={`${site.name} — home`}
    >
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="9" fill="var(--color-marigold)" />
        <circle cx="0" cy="16" r="4" fill="var(--color-ink-900)" />
        <circle cx="32" cy="16" r="4" fill="var(--color-ink-900)" />
        <path
          d="M9 16h13m-4-5 5 5-5 5"
          stroke="var(--color-ink-900)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-wide lowercase">
        {site.name}
      </span>
    </Link>
  );
}
