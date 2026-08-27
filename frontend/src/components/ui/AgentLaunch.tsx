import { Link } from "react-router-dom";
import type { AgentContext } from "../../lib/agentContext";
import { agentHref } from "../../lib/agentContext";
import { useAgentPanel } from "../../lib/agentPanel";

/**
 * The Agent, entered from the context that owns the object (docs/reviewnary_design.md §6, §8).
 *
 * <b>The label names the object in view.</b> A generic 「AI에게 묻기」 in the top-right of every page was
 * the product's only Agent affordance, and it said the same thing on a product, an inquiry and a
 * settings screen. Now the screen chooses: 「이 상품 분석하기」, 「이 문의 조사하기」, 「문의에서도
 * 반복되는지 확인」. The default label stays for the surfaces that have no single object.
 *
 * <b>It opens; it does not ask.</b> Inside the app shell the sentence lands in the contextual panel's
 * box (Contextual Agent Workspace v1) and the seller sends it; outside a shell (tests, bare renders) it
 * is the `/agent` link it always was. Nothing here starts a run.
 */
export function AgentLaunch({
  context,
  label = "AI에게 묻기",
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
  if (panel) {
    return (
      <button type="button" onClick={() => panel.openPanel(context ?? {})} className={classes} data-testid="agent-launch">
        <span aria-hidden="true" className="text-brand-700">✳︎</span>
        {label}
      </button>
    );
  }
  return (
    <Link to={agentHref(context)} className={classes} data-testid="agent-launch">
      <span aria-hidden="true" className="text-brand-700">✳︎</span>
      {label}
    </Link>
  );
}
