import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { MESSAGE, LAYOUT } from "../../lib/motion";
import { NavIcon } from "../icons/NavIcon";
import type { CurrentContext } from "../../lib/conversation/currentContext";

/**
 * The one line above the box that says WHAT the next sentence will be about (Working Context v1 §1).
 *
 * It sits between the transcript and the composer because that is where the seller's eyes are when
 * they decide what to type — a badge at the top of the page is a fact they scrolled past. It is quiet
 * on purpose: the object's name, where it came from, and a step only when one is running. It is not a
 * card, has no controls of its own beyond leaving, and never competes with the answer above it.
 *
 * 「해제」 is a real state change, not a visual dismissal: it goes to the runtime through the same focus
 * contract a click uses, and the anchor is dropped there. A bar that showed the anchor and could only
 * pretend to release it would be worse than no bar.
 */
export function ContextBar({ context, onClear }: { context: CurrentContext; onClear?: () => void }) {
  const anchored = context.kind === "ANCHOR";
  return (
    <motion.div
      layout="position"
      variants={MESSAGE}
      initial="hidden"
      animate="shown"
      transition={LAYOUT}
      className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5"
      data-testid="context-bar"
      aria-label="지금 보고 있는 것"
    >
      <span aria-hidden="true" className={`shrink-0 ${anchored ? "text-brand-700" : "text-muted"}`}>
        <NavIcon name={anchored ? "target" : "list"} className="h-4 w-4" />
      </span>
      <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm">
        {context.to ? (
          <Link to={context.to} className="min-w-0 truncate font-semibold text-ink hover:underline" data-testid="context-bar-label">
            {context.label}
          </Link>
        ) : (
          <span className="min-w-0 truncate font-semibold text-ink" data-testid="context-bar-label">{context.label}</span>
        )}
        {context.meta ? <span className="truncate text-muted">{context.meta}</span> : null}
        {context.task ? (
          <span className="shrink-0 font-medium text-brand-700" data-testid="context-bar-task">{context.task}</span>
        ) : null}
      </p>
      {context.clearable && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-muted transition hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          해제
        </button>
      ) : null}
    </motion.div>
  );
}
