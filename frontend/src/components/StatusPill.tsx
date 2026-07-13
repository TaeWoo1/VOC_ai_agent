import type { ReactNode } from "react";
import type { StatusTone } from "../lib/actionWindow/copy";

// Shared status palette (the RunStatusBadge visual, generalized). Tone → tint +
// text color, matching the tones the copy layer already assigns to run/step states.
const TONE_CLASS: Record<StatusTone, string> = {
  active: "bg-brand-50 text-brand-700",
  human: "bg-warn/10 text-warn",
  neutral: "bg-canvas text-muted",
  good: "bg-good/10 text-good",
  bad: "bg-bad/10 text-bad",
};

/**
 * Generic tone-based status pill. Reusable base for surfaces that need a status
 * chip without a domain-specific badge; `icon` is decorative (aria-hidden).
 */
export function StatusPill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: StatusTone;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${TONE_CLASS[tone]}`}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {label}
    </span>
  );
}
