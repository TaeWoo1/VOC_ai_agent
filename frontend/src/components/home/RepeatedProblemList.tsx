import { Link } from "react-router-dom";
import { productSpanLine, repeatLine } from "../../lib/repeatedIssue";
import { SEVERITY_LABEL_KO, changeBadges } from "../../lib/reviewIssuesView";
import type { HomeProblem, IssueSeverity } from "../../lib/types";

/**
 * <b>How a repeated problem reads on a Home — in one place, for every Home there is.</b>
 *
 * <p>There are two: the legacy 「오늘 확인할 것」 areas and 고객 운영 관리's. Until this component existed only the
 * first one drew these rows; the second collapsed the whole signal into 「관찰 중 20 · 보기」 — a count with no
 * problem in it, no product, no evidence, and a link to the list rather than to the problem. That is not a smaller
 * version of this row, it is a different claim, and the seller who saw it was the one whose org had eighteen pieces
 * of evidence for a single problem on a single product.
 *
 * <p><b>Nothing here judges anything.</b> The issue's lifecycle word, its severity and its trend labels are the
 * extractor's, printed verbatim; the count and its denominator are the per-product tally the problem's own screen
 * prints, from the same read. This component adds no number and derives none — in particular it never adds
 * {@code decidable} to {@code observing}, and never turns the pair into a rate.
 *
 * <p><b>It is not a task list.</b> No verb, no button, no {@code DecisionRow}: 관찰 중 means reviewnary concluded
 * nothing needs doing, and a Home that drew twenty observed problems as twenty pending tasks would be manufacturing
 * urgency out of an evidence trickle. Every row is a link out to the problem's own workspace, which is where a
 * decision about it is actually taken.
 */
export function RepeatedProblemList({ rows }: { rows: readonly HomeProblem[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
      {rows.map(({ issue, context }) => {
        const badges = changeBadges(issue.change);
        const top = context?.evidence?.byProduct?.[0];
        const severity =
          issue.severity in SEVERITY_LABEL_KO ? SEVERITY_LABEL_KO[issue.severity as IssueSeverity] : null;
        const span = top ? productSpanLine(top) : null;
        return (
          <li key={issue.id} className="space-y-1 p-3">
            <Link
              to={`/memory/${issue.id}`}
              className="break-keep font-semibold text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              {issue.title}
              <span className="ml-1 text-brand-700" aria-hidden="true">›</span>
            </Link>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span>{issue.lifecycleLabelKo}</span>
              {severity ? <span>심각도 {severity}</span> : null}
              {/* The trend judgement is the extractor's; a Home prints its word, not its own. */}
              {badges.map((badge) => (
                <span key={badge.kind}>{badge.labelKo}</span>
              ))}
            </p>
            {/* The denominator travels with its numerator, exactly as on the problem's own screen — and as a pair,
                never a rate. */}
            {top ? (
              <p className="break-keep text-sm tabular-nums text-muted">
                {top.productName ?? "이름이 확인되지 않은 상품"} · {repeatLine(top)}
              </p>
            ) : null}
            {/*
              When no trend fired, the dates are the only thing that says whether this is still happening — and a
              problem whose last evidence is nine months old is not what a seller reads 「반복 문제」 to mean. The
              span is this product's own, never the issue's union over every product, so another product's recent
              review cannot date this row. Printed only without badges: a row already saying 급증 does not need it,
              and two trend statements on one line read as two judgements.
            */}
            {!badges.length && span ? (
              <p className="break-keep text-sm tabular-nums text-muted">근거 기간 {span}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
