import type { ReactNode } from "react";

export interface Step {
  title: string;
  body: ReactNode;
}

/** Numbered vertical process list. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="border-blue/40 relative space-y-8 border-l-[3px] pl-8">
      {steps.map((step, i) => (
        <li key={step.title} className="relative">
          <span
            aria-hidden="true"
            className="bg-blue absolute text-white -left-[43px] flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
          >
            {i + 1}
          </span>
          <h3 className="text-brand-900 text-lg font-semibold">{step.title}</h3>
          <div className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {step.body}
          </div>
        </li>
      ))}
    </ol>
  );
}
