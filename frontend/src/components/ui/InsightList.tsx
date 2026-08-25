import { Link } from "react-router-dom";
import type { OperationsInsight } from "../../lib/types";

/**
 * The "지금 눈여겨볼 것" list.
 *
 * <b>A row, not a card.</b> Five equally-weighted cards is the layout problem the audit named; five
 * rows read in one pass and leave the metrics above them as the loudest thing on the page.
 *
 * <b>The whole row is the target, and it is the ONLY target</b> (Executive-friendly UX Redesign v1).
 * Each row used to carry a second 「AI에게 묻기」 link, so three rows printed the same four words three
 * times down the right edge under a page header that already offers 「AI에게 묻기」. Three identical
 * calls to action at identical weight is zero calls to action; `agentGoal` is still on the model and
 * still reaches the Agent from the header, it simply is not printed once per row.
 *
 * <b>An empty list renders nothing.</b> No "특이사항 없습니다" card: reassurance nobody measured is
 * worse than a shorter page, and every producer of these is allowed to return nothing.
 */
const DOT: Record<OperationsInsight["severity"], string> = {
  ATTENTION: "bg-bad",
  WATCH: "bg-warn",
  INFO: "bg-muted",
};

const SEVERITY_WORD: Record<OperationsInsight["severity"], string> = {
  ATTENTION: "확인 필요",
  WATCH: "지켜보기",
  INFO: "참고",
};

export function InsightList({ insights }: { insights: OperationsInsight[] }) {
  if (insights.length === 0) {
    return null;
  }
  return (
    <ul className="divide-y divide-line/70">
      {insights.map((insight) => (
        <li key={insight.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
          {/* Colour is never the only carrier — a reader who cannot see the dot hears the word. */}
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[insight.severity]}`} aria-hidden="true" />
          <span className="sr-only">{SEVERITY_WORD[insight.severity]}</span>
          <Link
            to={insight.to}
            className="min-w-0 flex-1 rounded-lg font-semibold text-ink hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            <span className="break-keep">{insight.title}</span>
            {insight.detail ? (
              <span className="ml-2 break-keep text-sm font-normal text-muted">{insight.detail}</span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
