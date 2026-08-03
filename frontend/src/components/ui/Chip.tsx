import type { ReactNode } from "react";

/**
 * Small inline label.
 *
 * Only two tones. The operating-status palette (`good`/`warn`/`bad`) is not exposed here on
 * purpose: a chip that can be coloured "green" invites showing a health claim the data does not
 * support. Status colour belongs to surfaces that own a verified state.
 */
export type ChipTone = "neutral" | "accent";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-canvas text-muted",
  accent: "bg-brand-50 text-brand-700",
};

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
