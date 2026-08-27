import { Link } from "react-router-dom";
import type { OperationsInsight } from "../../lib/types";
import { Status, type StatusTone } from "./Status";

/**
 * Findings, as rows (docs/reviewnary_design.md §7 홈).
 *
 * <b>The whole row is the target, and it is the ONLY target.</b> No per-row 「AI에게 묻기」: three
 * identical calls to action are zero calls to action.
 *
 * <b>An empty list renders nothing.</b> Reassurance nobody measured is worse than a shorter page.
 */
const TONE: Record<OperationsInsight["severity"], StatusTone> = {
  ATTENTION: "bad",
  WATCH: "warn",
  INFO: "neutral",
};

const SEVERITY_WORD: Record<OperationsInsight["severity"], string> = {
  ATTENTION: "확인 필요",
  WATCH: "지켜보기",
  INFO: "참고",
};

/**
 * Which rows are NOT counted over the screen's selected window. 「부정 리뷰 0건」 fifteen lines above
 * 「… 부정 리뷰 3건」 read as a contradiction until the span was said BEFORE the number.
 */
const SPAN_NOTE: Record<string, string> = {
  NEGATIVE_REVIEW_PRODUCT: "전체 기간",
  REPEATED_REVIEW_ISSUE: "전체 기간",
};

export function InsightList({ insights }: { insights: OperationsInsight[] }) {
  if (insights.length === 0) {
    return null;
  }
  return (
    <ul className="divide-y divide-line/70">
      {insights.map((insight) => (
        <li key={insight.key}>
          <Link
            to={insight.to}
            className="flex items-start gap-3 px-4 py-3 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <Status tone={TONE[insight.severity]} variant="word">
                  {SEVERITY_WORD[insight.severity]}
                </Status>
                {SPAN_NOTE[insight.key] ? (
                  <span className="text-sm text-muted">{SPAN_NOTE[insight.key]}</span>
                ) : null}
              </div>
              <p className="mt-0.5 break-keep text-base font-semibold leading-snug text-ink">
                {insight.title}
                {insight.detail ? (
                  <span className="ml-2 break-keep text-sm font-normal text-muted">{insight.detail}</span>
                ) : null}
              </p>
            </div>
            <span aria-hidden="true" className="mt-1 shrink-0 text-muted">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
