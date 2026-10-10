import type { ReactNode } from "react";

type Tone = "positive" | "neutral" | "muted" | "warning";

const tones: Record<Tone, string> = {
  positive: "bg-accent-500/12 text-accent-600 ring-accent-500/30",
  neutral: "bg-marigold-soft text-marigold-deep ring-marigold/40",
  muted: "bg-slate-100 text-slate-600 ring-slate-300",
  warning: "bg-rosa-soft text-rosa ring-rosa/30",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
