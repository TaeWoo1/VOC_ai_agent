// Pure presentation helpers for operator attention signals: severity → Tailwind
// style and a defensive client-side severity sort. Kept out of the component so the
// mapping/ordering can be unit-tested without a DOM (the backend already ranks
// signals; this guards against an unsorted payload and centralizes the styling).

import type { AttentionSignal } from "./types";

export interface SeverityStyle {
  /** Badge background + text color classes. */
  badge: string;
  /** Short Korean severity label. */
  label: string;
}

const SEVERITY_STYLE: Record<string, SeverityStyle> = {
  HIGH: { badge: "bg-bad/10 text-bad", label: "높음" },
  MEDIUM: { badge: "bg-warn/10 text-warn", label: "보통" },
  LOW: { badge: "bg-ink/5 text-muted", label: "낮음" },
};

/** Most-urgent first; unknown severities rank last. */
const SEVERITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Style for a severity; unknown values fall back to the LOW (muted) style. */
export function severityStyle(severity: string): SeverityStyle {
  return SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.LOW;
}

/** Stable sort by severity (HIGH → LOW); does not mutate the input. */
export function sortBySeverity(items: AttentionSignal[]): AttentionSignal[] {
  return [...items].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );
}
