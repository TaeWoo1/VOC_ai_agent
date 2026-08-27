import type { ReactNode } from "react";

/**
 * Small inline label.
 *
 * <b>Three tones, and each one means exactly one thing</b> (Executive-friendly UX Redesign v1):
 * `accent` (파랑) = SellerOps prepared something, `attention` (주황) = the seller has to look at this
 * now, `neutral` = reference. `good`/`bad` are still not exposed: a chip that can be coloured green
 * invites showing a health claim the data does not support, and status colour belongs to surfaces
 * that own a verified state.
 *
 * A tone never carries meaning by itself — every chip in the product has a word in it, because
 * colour is not available to every reader (`ui-ux-pro-max` ux/Color Only, severity High).
 */
export type ChipTone = "neutral" | "accent" | "attention";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-canvas text-muted",
  accent: "bg-brand-50 text-brand-700",
  attention: "bg-warn/10 text-warn",
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
