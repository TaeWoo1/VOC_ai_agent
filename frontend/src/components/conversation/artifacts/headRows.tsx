import { useState } from "react";

/**
 * **A list answers by showing a few and offering the rest.**
 *
 * Measured on the real Demo Org, 2026-09-02: a single ordinary turn printed 20 inquiry rows and another
 * printed 24 review rows, so the seller's answer — one sentence — arrived on top of a page of table. The
 * judgement is the answer; the rows are the evidence for it, and evidence is read on purpose.
 *
 * Four is the head: enough to see the shape of what came back (and to recognise the one they meant), few
 * enough that the sentence above it is still the biggest thing in the turn. The rest is one press away and
 * the count is always stated, so nothing is hidden — only not shouted.
 */
export const HEAD_ROWS = 4;

export function useHeadRows(total: number, head = HEAD_ROWS) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? total : Math.min(head, total);
  return { shown, hidden: total - shown, expanded, expand: () => setExpanded(true) };
}

/** The one control that brings the rest of a list back. Quiet on purpose — it is never the turn's action. */
export function MoreRows({ hidden, noun, onExpand }: { hidden: number; noun: string; onExpand: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full border-t border-line/70 px-4 py-2 text-left text-sm text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {noun} {hidden}건 더 보기
    </button>
  );
}
