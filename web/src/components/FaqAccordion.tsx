import type { FaqItem } from "@/lib/faq";

/**
 * Accessible disclosure list built on native <details>/<summary> — keyboard
 * operable and screen-reader friendly with no JavaScript.
 */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white">
      {items.map((item) => (
        <details key={item.question} className="group px-5">
          <summary className="text-brand-900 flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-semibold [&::-webkit-details-marker]:hidden">
            {item.question}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="text-brand-500 shrink-0 transition-transform group-open:rotate-45"
            >
              <path
                d="M10 4v12M4 10h12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
