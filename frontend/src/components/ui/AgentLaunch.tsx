import { Link } from "react-router-dom";
import type { AgentContext } from "../../lib/agentContext";
import { agentHref } from "../../lib/agentContext";

/**
 * The one way into the Agent, offered from every operations screen.
 *
 * <b>`nav.v2.ts` already said this was the design</b> — "an action offered inside the operations
 * screens, not a destination" — and then no screen offered it, so `/agent` was reachable only by
 * typing the URL. This component is the missing half.
 *
 * <b>It navigates; it does not ask.</b> The suggested sentence arrives in the Agent's input box and
 * the seller sends it. Nothing here starts a run, so nothing here can spend the org's daily budget by
 * being clicked on the way past.
 */
export function AgentLaunch({
  context,
  label = "AI에게 묻기",
  className,
}: {
  context?: AgentContext;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      to={agentHref(context)}
      className={`inline-flex min-h-[36px] items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-brand/40 hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${className ?? ""}`}
    >
      <span aria-hidden="true">✳︎</span>
      {label}
    </Link>
  );
}
