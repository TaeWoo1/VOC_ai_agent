import { Link } from "react-router-dom";
import type { AgentContext } from "../../lib/agentContext";
import { agentHref } from "../../lib/agentContext";
import { useAgentPanel } from "../../lib/agentPanel";

/**
 * The Agent, entered from the context that owns the object (docs/reviewnary_design.md §6, §8).
 *
 * <b>The label names the object in view, open-ended.</b> 「이 상품에 대해 물어보기」, 「이 문의에 대해
 * 물어보기」 — a context, not a feature button. The feature-shaped launchers (문제 있는 상품 찾기 …)
 * became example chips inside the panel composer for that surface.
 *
 * <b>It opens; it does not ask.</b> Inside the app shell the sentence lands in the contextual panel's
 * box (Contextual Agent Workspace v1) and the seller sends it; outside a shell (tests, bare renders) it
 * is the `/agent` link it always was. Nothing here starts a run.
 */
export function AgentLaunch({
  context,
  label = "물어보기",
  className,
  size = "sm",
}: {
  context?: AgentContext;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const sizing = size === "md" ? "min-h-[40px] px-4 text-base" : "min-h-[36px] px-3 text-sm";
  const classes = `inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface font-semibold text-ink transition hover:border-brand/40 hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${sizing} ${className ?? ""}`;
  const panel = useAgentPanel();
  // The launcher lands NO sentence (Agentic Operating Workspace v2 §3-D): it opens the conversation
  // with the surface hint only, and the box is empty for the seller's own words.
  const { goal: _goal, ...hint } = context ?? {};
  if (panel) {
    return (
      <button type="button" onClick={() => panel.openPanel(hint)} className={classes} data-testid="agent-launch">
        <span aria-hidden="true" className="text-brand-700">✳︎</span>
        {label}
      </button>
    );
  }
  return (
    <Link to={agentHref(hint)} className={classes} data-testid="agent-launch">
      <span aria-hidden="true" className="text-brand-700">✳︎</span>
      {label}
    </Link>
  );
}
