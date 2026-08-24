import { Link } from "react-router-dom";
import type { OperationsInsight } from "../../lib/types";
import { agentHref } from "../../lib/agentContext";

/**
 * The "지금 눈여겨볼 것" list.
 *
 * <b>A row, not a card.</b> Five equally-weighted cards is the layout problem the audit named; five
 * rows read in one pass and leave the metrics above them as the loudest thing on the page.
 *
 * <b>The whole row is the target.</b> The audit found the app scattered with small outline buttons
 * doing the job of list items. A row that navigates on click needs no button inside it, and the
 * secondary Agent link is the one exception — it goes somewhere else.
 *
 * <b>An empty list renders nothing.</b> No "특이사항 없습니다" card: reassurance nobody measured is
 * worse than a shorter page, and every producer of these is allowed to return nothing.
 */
const DOT: Record<OperationsInsight["severity"], string> = {
  ATTENTION: "bg-bad",
  WATCH: "bg-warn",
  INFO: "bg-muted",
};

export function InsightList({ insights }: { insights: OperationsInsight[] }) {
  if (insights.length === 0) {
    return null;
  }
  return (
    <ul className="divide-y divide-line/70">
      {insights.map((insight) => (
        <li key={insight.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[insight.severity]}`} aria-hidden="true" />
          <Link
            to={insight.to}
            className="min-w-0 flex-1 rounded-lg font-semibold text-ink hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            <span className="break-keep">{insight.title}</span>
            {insight.detail ? (
              <span className="ml-2 break-keep text-sm font-normal text-muted">{insight.detail}</span>
            ) : null}
          </Link>
          {insight.agentGoal ? (
            <Link
              to={agentHref({ goal: insight.agentGoal })}
              className="shrink-0 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              AI에게 묻기
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
